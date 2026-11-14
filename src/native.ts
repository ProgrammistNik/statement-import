import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import * as NativeFiles from 'expo-file-system/legacy';
import { makeApi, Transport } from './api';
import { FileAccess, ImportController, inspectFile, MAX_BYTES, Operation, PendingFile, Storage } from './core';

const pending = new Directory(Paths.cache, 'statement-pending');
const STORAGE_KEY = 'statement.operation.v1';
export const SETTINGS_KEY = 'statement.server.v1';
export const defaultServer = 'http://127.0.0.1:8787';

const files: FileAccess = {
  exists: uri => new File(uri).exists,
  remove: async uri => { const file = new File(uri); if (file.exists) file.delete(); },
  sweep: async keep => {
    if (!pending.exists) pending.create({ intermediates: true });
    for (const entry of pending.list()) if (entry.uri !== keep) entry.delete();
    const picker = new Directory(Paths.cache, 'DocumentPicker');
    if (picker.exists) for (const entry of picker.list()) entry.delete();
  },
};

const storage: Storage = {
  read: async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const op = JSON.parse(raw) as Operation | null;
    if (op === null) return null;
    if (typeof op.key !== 'string' || typeof op.baseUrl !== 'string' || !['selected', 'posting', 'unknown', 'queued', 'processing', 'ready', 'error', 'deleting', 'deleted', 'delete-error'].includes(op.phase)) throw new Error('Invalid local state');
    return op;
  },
  write: async op => { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(op)); },
};

const nativeTransport: Transport = async (url, init) => {
  if (!(init?.body instanceof File)) return (expoFetch as unknown as Transport)(url, init);
  const task = NativeFiles.createUploadTask(url, init.body.uri, {
    httpMethod: 'POST',
    uploadType: NativeFiles.FileSystemUploadType.BINARY_CONTENT,
    sessionType: NativeFiles.FileSystemSessionType.FOREGROUND,
    headers: init.headers as Record<string, string>,
  });
  const cancel = () => { task.cancelAsync().catch(() => {}); };
  if (init.signal?.aborted) throw new Error('Upload aborted');
  init.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await task.uploadAsync();
    if (!result) throw new Error('Upload interrupted');
    return new Response(result.body, { status: result.status, headers: result.headers });
  } finally { init.signal?.removeEventListener('abort', cancel); }
};

export const controller = new ImportController(storage, files, makeApi(nativeTransport, uri => new File(uri)), Crypto.randomUUID);

export async function pickFile(): Promise<PendingFile | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const source = new File(asset.uri);
  try {
    const size = source.size;
    if (size > MAX_BYTES) throw new Error('Файл больше 10 МиБ. Выберите файл меньшего размера');
    const handle = source.open();
    let head: Uint8Array;
    let tail: Uint8Array;
    try {
      head = handle.readBytes(Math.min(size, 4096));
      handle.offset = Math.max(0, size - 1024);
      tail = handle.readBytes(Math.min(size, 1024));
    } finally { handle.close(); }
    const format = inspectFile(size, head, tail);
    if (!pending.exists) pending.create({ intermediates: true });
    const target = new File(pending, Crypto.randomUUID());
    source.move(target);
    return { uri: target.uri, name: asset.name, size, format };
  } catch (error) {
    if (source.exists) source.delete();
    throw error;
  }
}

export function privateCopyCount() { return pending.exists ? pending.list().length : 0; }

export function normalizeServer(text: string) {
  const url = new URL(text.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Введите адрес сервера без пути и параметров');
  return url.origin;
}

export async function diagnosticRequest(base: string, path: string, payload?: unknown) {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 5000);
  try {
    const response = await expoFetch(`${base}${path}`, payload === undefined ? { signal: abort.signal } : { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error('Сервер недоступен');
    return await response.json();
  } finally { clearTimeout(timeout); }
}
