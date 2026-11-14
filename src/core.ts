export type Status = 'queued' | 'processing' | 'ready' | 'error' | 'deleting' | 'deleted';
export type Phase = 'selected' | 'posting' | 'unknown' | Status | 'delete-error';
export type Item = { id: string; merchant: string; amountMinor: number; cadence: string; lastSeen: string };
export type Job = { jobId: string; status: Status; revision: number; currency?: string; items?: Item[] };
export type PendingFile = { uri: string; name: string; size: number; format: 'PDF' | 'CSV' };
export type Operation = {
  key: string;
  baseUrl: string;
  phase: Phase;
  file?: PendingFile;
  job?: Job;
  deleteKey?: string;
  deleteIntent?: boolean;
};
export type Snapshot = { operation: Operation | null; busy: boolean; initialized: boolean; message: string; ignored: number };
export type Storage = { read(): Promise<Operation | null>; write(value: Operation | null): Promise<void> };
export type FileAccess = { remove(uri: string): Promise<void>; exists(uri: string): boolean; sweep(keep?: string): Promise<void> };
export type Api = { create(op: Operation): Promise<Job>; find(op: Operation): Promise<Job | null>; get(op: Operation): Promise<Job>; remove(op: Operation): Promise<Job> };

export class ApiError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

export const MAX_BYTES = 10 * 1024 * 1024;

export function inspectFile(size: number, head: Uint8Array, tail: Uint8Array): 'PDF' | 'CSV' {
  if (!Number.isFinite(size) || size <= 0) throw new Error('Файл пустой или недоступен');
  if (size > MAX_BYTES) throw new Error('Файл больше 10 МиБ. Выберите файл меньшего размера');
  const text = (bytes: Uint8Array) => Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  const first = text(head);
  if (/^%PDF-\d\.\d/.test(first) && text(tail).includes('%%EOF')) return 'PDF';
  if (!head.includes(0) && first.replace(/\r/g, '').startsWith('date,description,amount\n') && first.split('\n').filter(line => line.trim()).length >= 2) return 'CSV';
  throw new Error('Содержимое не соответствует PDF или CSV выписке');
}

export function readJob(value: unknown): Job {
  if (!value || typeof value !== 'object') throw new Error('Некорректный ответ сервера');
  const job = value as Job;
  if (typeof job.jobId !== 'string' || !/^job-demo-\d+$/.test(job.jobId) || !Number.isInteger(job.revision) || job.revision < 1 || !['queued', 'processing', 'ready', 'error', 'deleting', 'deleted'].includes(job.status)) throw new Error('Некорректный ответ сервера');
  if (job.status === 'ready' && (job.currency !== 'AUD' || !Array.isArray(job.items) || !job.items.every(item => typeof item.id === 'string' && typeof item.merchant === 'string' && Number.isSafeInteger(item.amountMinor) && item.amountMinor >= 0 && item.cadence === 'monthly' && /^\d{4}-\d{2}-\d{2}$/.test(item.lastSeen)))) throw new Error('Некорректный отчет');
  return job;
}

export class ImportController {
  private snapshot: Snapshot = { operation: null, busy: false, initialized: false, message: '', ignored: 0 };
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private refreshing = false;

  constructor(private storage: Storage, private files: FileAccess, private api: Api, private uuid: () => string) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private emit(patch: Partial<Snapshot>) {
    if (this.closed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(listener => listener());
  }

  private async save(operation: Operation | null) {
    await this.storage.write(operation);
    this.emit({ operation });
  }

  private run(action: () => Promise<void>, background = false) {
    const task = this.queue.then(async () => {
      if (this.closed) return;
      if (!background) this.emit({ busy: true, message: '' });
      try { await action(); }
      catch { this.emit({ message: 'Не удалось сохранить или прочитать данные. Повторите действие' }); }
      finally { if (!background) this.emit({ busy: false }); }
    });
    this.queue = task.catch(() => {});
    return task;
  }

  initialize = () => this.run(async () => {
    const op = await this.storage.read();
    await this.files.sweep(op?.file?.uri);
    await this.save(op?.phase === 'posting' ? { ...op, phase: 'unknown' } : op);
    this.emit({ initialized: true });
    if (op && op.phase !== 'selected' && op.phase !== 'deleted') await this.refreshNow();
  });

  select = (file: PendingFile, baseUrl: string) => this.run(async () => {
    const old = this.snapshot.operation;
    if (old && old.phase !== 'selected' && old.phase !== 'deleted') {
      await this.files.remove(file.uri);
      this.emit({ message: 'Сначала завершите текущий импорт' });
      return;
    }
    const next: Operation = { key: this.uuid(), phase: 'selected', file, baseUrl };
    try { await this.save(next); }
    catch (error) { await this.files.remove(file.uri); throw error; }
    if (old?.file) await this.files.remove(old.file.uri);
  });

  cancel = () => this.run(async () => {
    const op = this.snapshot.operation;
    if (!op || !['selected', 'deleted'].includes(op.phase)) return;
    if (op.file) await this.files.remove(op.file.uri);
    await this.save(null);
  });

  submit = () => this.run(async () => {
    const op = this.snapshot.operation;
    if (!op || op.phase !== 'selected') return;
    await this.post(op);
  });

  private async post(op: Operation) {
    if (!op.file || !this.files.exists(op.file.uri)) {
      this.emit({ message: 'Временная копия файла недоступна. Проверьте состояние импорта' });
      return;
    }
    await this.save({ ...op, phase: 'posting' });
    try { await this.accept(await this.api.create(op)); }
    catch (error) {
      await this.save({ ...this.snapshot.operation!, phase: 'unknown' });
      this.emit({ message: error instanceof ApiError && error.status === 409 ? 'Ключ уже связан с другим файлом. Проверьте состояние импорта' : 'Ответ не получен. Импорт мог быть создан. Проверьте его состояние' });
    }
  }

  recover = () => this.run(async () => {
    const op = this.snapshot.operation;
    if (!op || op.phase !== 'unknown') return;
    try {
      const job = await this.api.find(op);
      if (job) await this.accept(job);
      else await this.post(op);
    } catch {
      this.emit({ message: 'Связь с сервером недоступна. Ключ импорта сохранен, повторите проверку' });
    }
  });

  private async accept(job: Job) {
    const op = this.snapshot.operation;
    if (!op) return;
    if ((op.job && op.job.jobId !== job.jobId) || op.phase === 'deleted' || (op.job && job.revision < op.job.revision) || (op.deleteIntent && !['deleting', 'deleted'].includes(job.status))) {
      this.emit({ ignored: this.snapshot.ignored + 1 });
      return;
    }
    if (op.job && job.revision === op.job.revision && job.status !== op.job.status) {
      this.emit({ ignored: this.snapshot.ignored + 1 });
      return;
    }
    if (op.job?.revision === job.revision && op.phase === job.status && !op.file) {
      if (this.snapshot.message) this.emit({ message: '' });
      return;
    }
    const next = { ...op, job, phase: job.status };
    await this.save(next);
    if (next.file) {
      await this.files.remove(next.file.uri);
      await this.save({ ...next, file: undefined });
    }
  }

  refresh = () => {
    const op = this.snapshot.operation;
    if (this.snapshot.busy || this.refreshing || !this.snapshot.initialized || !op || ['selected', 'posting', 'unknown', 'deleted'].includes(op.phase)) return Promise.resolve();
    this.refreshing = true;
    return this.run(() => this.refreshNow(), true).finally(() => { this.refreshing = false; });
  };

  private async refreshNow() {
    const op = this.snapshot.operation;
    if (!op || ['selected', 'posting', 'deleted'].includes(op.phase)) return;
    try {
      const job = op.job ? await this.api.get(op) : await this.api.find(op);
      if (job) await this.accept(job);
      else this.emit({ message: 'Сервер пока не нашел импорт. Повторите проверку с тем же ключом' });
    } catch {
      this.emit({ message: 'Нет ответа от сервера. Последнее подтвержденное состояние сохранено' });
    }
  }

  remove = () => this.run(async () => {
    const op = this.snapshot.operation;
    if (!op?.job || op.phase === 'deleted') return;
    const deleting: Operation = { ...op, deleteKey: op.deleteKey ?? this.uuid(), deleteIntent: true, phase: 'deleting' };
    await this.save(deleting);
    try {
      const response = await this.api.remove(deleting);
      if (response.status !== 'deleting') throw new Error('Deletion requires GET confirmation');
      await this.accept(response);
    }
    catch {
      await this.save({ ...deleting, phase: 'delete-error' });
      this.emit({ message: 'Удаление не подтверждено. Данные могут оставаться на сервере. Повторите удаление' });
    }
  });

  close() { this.closed = true; this.listeners.clear(); }
}
