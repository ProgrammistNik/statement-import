import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, AppState, Modal, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useFonts, Manrope_400Regular, Manrope_500Medium, Manrope_700Bold } from '@expo-google-fonts/manrope';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Item, Phase } from './src/core';
import { controller, defaultServer, diagnosticRequest, normalizeServer, pickFile, privateCopyCount, SETTINGS_KEY } from './src/native';
import { colors as c, fonts as f } from './src/theme';

function Button({ title, onPress, secondary = false, disabled = false, id }: { title: string; onPress: () => void; secondary?: boolean; disabled?: boolean; id: string }) {
  return <Pressable testID={id} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, secondary && s.secondary, (pressed || disabled) && { opacity: disabled ? 0.45 : 0.8 }]}><Text style={[s.buttonText, secondary && { color: c.primary }]}>{title}</Text></Pressable>;
}

const titles: Record<Phase, string> = {
  selected: 'Все готово к отправке', posting: 'Отправляем выписку', unknown: 'Проверим, дошел ли файл', queued: 'Импорт в очереди',
  processing: 'Собираем ваш отчет', ready: 'Ваши регулярные расходы', error: 'Импорт не завершен', deleting: 'Удаляем импорт', deleted: 'Импорт удален', 'delete-error': 'Удаление не подтверждено',
};
const descriptions: Record<Phase, string> = {
  selected: 'Проверьте файл. Отправка начнется только после подтверждения.', posting: 'Дождитесь ответа. Не нужно выбирать файл повторно.',
  unknown: 'Ответ сервера потерялся. Проверим существующий импорт, чтобы не создать второй.', queued: 'Файл принят. Отчет появится после обработки.',
  processing: 'Сервер обрабатывает файл. Можно закрыть приложение и вернуться позже.', ready: 'Найдены повторяющиеся платежи из вашей выписки.',
  error: 'Сервер сообщил об ошибке обработки. Этот импорт можно удалить.', deleting: 'Запрос отправлен. Ждем подтверждение удаления от сервера.',
  deleted: 'Сервер подтвердил удаление. Временная копия файла также очищена.', 'delete-error': 'Сервер не подтвердил удаление. Данные могут оставаться на сервере.',
};

export default function App() {
  const [fontsLoaded, fontError] = useFonts({ Manrope_400Regular, Manrope_500Medium, Manrope_700Bold });
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [screen, setScreen] = useState<'main' | 'diagnostics'>('main');
  const [server, setServer] = useState(defaultServer);
  const [draftServer, setDraftServer] = useState(defaultServer);
  const [localError, setLocalError] = useState('');
  const [picking, setPicking] = useState(false);
  const [detail, setDetail] = useState<Item | null>(null);
  const [stats, setStats] = useState<{ mode: string; stats: Record<string, number> } | null>(null);
  const [diagnosticMessage, setDiagnosticMessage] = useState('');
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const op = state.operation;
  const phase = op?.phase;
  const endpoint = op?.baseUrl ?? server;
  const active = !!op && phase !== 'deleted' && phase !== 'selected';

  useEffect(() => {
    controller.initialize();
    AsyncStorage.getItem(SETTINGS_KEY).then(value => { if (value) { setServer(value); setDraftServer(value); } }).catch(() => {});
    const interval = setInterval(() => { if (AppState.currentState === 'active') controller.refresh(); }, 1000);
    const subscription = AppState.addEventListener('change', next => { if (next === 'active') controller.refresh(); });
    return () => { clearInterval(interval); subscription.remove(); };
  }, []);

  async function choose() {
    if (picking) return;
    setPicking(true); setLocalError('');
    try { const file = await pickFile(); if (file) await controller.select(file, server); }
    catch (error) { setLocalError(error instanceof Error ? error.message : 'Не удалось открыть файл'); }
    finally { setPicking(false); }
  }

  async function diagnose(mode?: string) {
    setDiagnosticBusy(true); setDiagnosticMessage('');
    try {
      if (mode) await diagnosticRequest(endpoint, '/__test/scenario', { mode });
      setStats(await diagnosticRequest(endpoint, '/__test/state'));
    } catch { setDiagnosticMessage('Нет связи с локальным сервером. Проверьте адрес и подключение'); }
    finally { setDiagnosticBusy(false); }
  }

  function deleteImport() {
    Alert.alert('Удалить импорт?', 'Отчет исчезнет после подтверждения сервера. Исходный файл на устройстве останется.', [
      { text: 'Оставить', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => controller.remove() },
    ]);
  }

  if (!fontsLoaded && !fontError) return <SafeAreaProvider><SafeAreaView style={s.root}><ActivityIndicator accessibilityLabel="Загрузка приложения" /></SafeAreaView></SafeAreaProvider>;

  return <SafeAreaProvider><SafeAreaView style={s.root}>
    <StatusBar barStyle="dark-content" backgroundColor={c.background} />
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <View style={s.header}>
        <View style={s.brand}><View style={s.brandMark}><Text style={s.brandLetter}>S</Text></View><Text style={s.brandName}>Statement</Text></View>
        <Pressable testID="open-diagnostics" accessibilityRole="button" accessibilityLabel={screen === 'main' ? 'Открыть диагностику' : 'Вернуться к импорту'} onPress={() => { if (screen === 'main') { setScreen('diagnostics'); diagnose(); } else setScreen('main'); }} style={s.headerAction}><Text style={s.headerActionText}>{screen === 'main' ? 'Настройки' : 'Назад'}</Text></Pressable>
      </View>
      {screen === 'diagnostics' ? <>
        <Text style={s.eyebrow}>ПРОВЕРКА ПРИЛОЖЕНИЯ</Text><Text style={s.title}>Диагностика</Text>
        <Text style={s.body}>Сценарии локального mock API. Эти настройки используются только для тестового задания.</Text>
        <View style={s.panel}><Text style={s.sectionTitle}>Адрес сервера</Text><TextInput testID="server-input" accessibilityLabel="Адрес сервера" style={s.input} value={draftServer} onChangeText={setDraftServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!op || phase === 'deleted'} />
          <Button id="save-server" title="Сохранить адрес" secondary disabled={!!op && phase !== 'deleted'} onPress={async () => { try { const next = normalizeServer(draftServer); await AsyncStorage.setItem(SETTINGS_KEY, next); setServer(next); setDraftServer(next); setDiagnosticMessage('Адрес сохранен'); } catch { setDiagnosticMessage('Не удалось сохранить адрес. Пример: http://127.0.0.1:8787'); } }} />
          <Text style={s.caption}>Во время операции адрес закреплен за импортом.</Text></View>
        <View style={s.panel}><Text style={s.sectionTitle}>Сценарий сервера</Text>{['happy', 'lost_ack', 'stale_status', 'delete_failure'].map(mode => <Button id={`scenario-${mode}`} key={mode} title={mode} secondary={stats?.mode !== mode} disabled={diagnosticBusy} onPress={() => diagnose(mode)} />)}</View>
        <View style={s.panel}><Text style={s.sectionTitle}>Результаты проверки</Text>
          <Text testID="diagnostic-counts" style={s.mono}>Режим: {stats?.mode ?? 'нет данных'}{'\n'}POST: {stats?.stats.createRequests ?? 0}{'\n'}Создано импортов: {stats?.stats.newJobs ?? 0}{'\n'}Удалений: {stats?.stats.deleteRequests ?? 0}{'\n'}Принято байт: {stats?.stats.acceptedBytes ?? 0}{'\n'}Ревизия: {op?.job?.revision ?? 0}{'\n'}Отброшено ответов: {state.ignored}{'\n'}Временных копий: {privateCopyCount()}</Text>
          <Button id="refresh-diagnostics" title="Обновить счетчики" secondary disabled={diagnosticBusy} onPress={() => diagnose()} />
          <Button id="reset-mock" title="Сбросить тестовый сервер" secondary disabled={!!op && phase !== 'deleted'} onPress={async () => { try { await controller.cancel(); await diagnosticRequest(endpoint, '/__test/reset', {}); await diagnose(); } catch { setDiagnosticMessage('Не удалось сбросить сервер'); } }} />
        </View>{diagnosticMessage ? <Text accessibilityRole="alert" style={s.notice}>{diagnosticMessage}</Text> : null}
        <Button id="back-main" title="Вернуться к импорту" onPress={() => setScreen('main')} />
      </> : <>
        <Text style={s.eyebrow}>РАСХОДЫ ПОД КОНТРОЛЕМ</Text>
        <Text testID="screen-title" style={s.title}>{phase ? titles[phase] : 'Одна выписка.\nПонятные расходы.'}</Text>
        <Text style={s.body}>{phase ? descriptions[phase] : 'Загрузите выписку и посмотрите, какие платежи повторяются каждый месяц.'}</Text>
        {!state.initialized ? <View style={s.panel}><ActivityIndicator color={c.primary} /><Text style={s.body}>Восстанавливаем состояние</Text><Button id="retry-initialize" title="Повторить" secondary onPress={() => controller.initialize()} /></View> : null}
        {(!phase || phase === 'deleted') && state.initialized ? <>
          {phase === 'deleted' ? <View style={s.successPanel}><Text style={s.sectionTitle}>Удаление подтверждено</Text><Text style={s.body}>Локальная копия очищена</Text></View> : <View style={s.preview}><Text style={s.previewLabel}>ВАШ БУДУЩИЙ ОТЧЕТ</Text><View style={s.previewRow}><View style={s.lineLong} /><View style={s.lineShort} /></View><View style={s.previewRow}><View style={s.lineMedium} /><View style={s.lineShort} /></View><View style={s.previewDivider} /><Text style={s.previewFoot}>Регулярные платежи в одном месте</Text></View>}
          <Button id="pick-file" title={picking ? 'Открываем файлы' : 'Выбрать выписку'} disabled={picking || state.busy} onPress={choose} />
          <Text style={s.caption}>PDF или CSV, не больше 10 МиБ</Text>
          <View style={s.info}><Text style={s.sectionTitle}>Вы управляете файлом</Text><Text style={s.body}>Проверяем содержимое до отправки. Временную копию удаляем после приема сервером или отмены выбора.</Text></View>
        </> : null}
        {op?.file && phase === 'selected' ? <View style={s.panel}><View style={s.fileBadge}><Text style={s.fileBadgeText}>{op.file.format}</Text></View><Text testID="selected-name" style={s.fileName}>{op.file.name}</Text><Text style={s.body}>{(op.file.size / 1024).toFixed(1)} КиБ</Text><Text style={s.verified}>Содержимое проверено</Text><Button id="confirm-import" title="Отправить выписку" disabled={state.busy} onPress={() => controller.submit()} /><Button id="cancel-selection" title="Отменить выбор" secondary disabled={state.busy} onPress={() => controller.cancel()} /></View> : null}
        {phase && ['posting', 'queued', 'processing', 'unknown'].includes(phase) ? <View style={s.panel}>
          <View style={s.progressTop}><ActivityIndicator color={c.primary} /><Text testID="import-status" style={s.sectionTitle}>{phase === 'unknown' ? 'Исход пока неизвестен' : phase === 'queued' ? 'В очереди' : phase === 'processing' ? 'Обработка' : 'Отправка'}</Text></View>
          {['Файл проверен', 'Принят сервером', 'Отчет готов'].map((step, index) => <View key={step} style={s.step}><View style={[s.stepDot, (index === 0 || (index === 1 && !!op?.job)) && s.stepDone]} /><Text style={s.body}>{step}</Text></View>)}
          {phase === 'unknown' ? <Button id="recover-import" title="Проверить и восстановить" disabled={state.busy} onPress={() => controller.recover()} /> : null}
        </View> : null}
        {phase === 'ready' && op?.job?.items ? <>
          <View style={s.totalPanel}><Text style={s.previewLabel}>ЕЖЕМЕСЯЧНО</Text><Text testID="total-amount" style={s.total}>{(op.job.items.reduce((sum, item) => sum + item.amountMinor, 0) / 100).toFixed(2)} <Text style={s.currency}>AUD</Text></Text><Text style={s.body}>{op.job.items.length} регулярных платежа</Text></View>
          <Text style={s.sectionTitle}>Найденные платежи</Text>
          {op.job.items.map((item, i) => <View key={item.id} style={s.payment}><View style={s.paymentTop}><View style={[s.paymentIcon, i === 1 && { backgroundColor: c.accent }]}><Text style={s.paymentInitial}>{item.merchant.slice(0, 1)}</Text></View><View style={s.paymentInfo}><Text style={s.sectionTitle}>{item.merchant}</Text><Text style={s.captionLeft}>Каждый месяц</Text></View></View><View style={s.paymentBottom}><Text style={s.amount}>{(item.amountMinor / 100).toFixed(2)} AUD</Text><Pressable testID={`details-${item.id}`} accessibilityLabel={`Подробнее о ${item.merchant}`} accessibilityRole="button" style={s.detailButton} onPress={() => setDetail(item)}><Text style={s.link}>Подробнее</Text></Pressable></View></View>)}
          <Button id="delete-import" title="Удалить импорт" secondary disabled={state.busy} onPress={deleteImport} />
        </> : null}
        {phase && ['deleting', 'delete-error', 'error'].includes(phase) ? <View style={s.panel}><Text testID="delete-status" style={[s.sectionTitle, { color: phase === 'deleting' ? c.warning : c.error }]}>{phase === 'deleting' ? 'Ожидаем подтверждение' : phase === 'delete-error' ? 'Данные еще не удалены' : 'Ошибка обработки'}</Text>{phase === 'deleting' ? <ActivityIndicator color={c.warning} /> : <Button id="retry-delete" title="Повторить удаление" disabled={state.busy} onPress={() => controller.remove()} />}</View> : null}
        {active && !['ready', 'deleting', 'delete-error', 'unknown', 'error', 'posting'].includes(phase!) && op?.job ? <Button id="delete-pending" title="Удалить импорт" secondary disabled={state.busy} onPress={deleteImport} /> : null}
        {localError || state.message ? <View accessibilityRole="alert" testID="error-message" style={s.errorPanel}><Text style={s.errorText}>{localError || state.message}</Text></View> : null}
        <Text style={s.footer}>Тестовое приложение. Только вымышленные данные.</Text>
      </>}
    </ScrollView>
    <Modal visible={!!detail} animationType="slide" onRequestClose={() => setDetail(null)} presentationStyle="pageSheet">
      <SafeAreaView style={s.root}><ScrollView contentContainerStyle={s.scroll}><Text style={s.eyebrow}>КАРТОЧКА ПЛАТЕЖА</Text><Text style={s.title}>{detail?.merchant}</Text><View style={s.totalPanel}><Text style={s.total}>{((detail?.amountMinor ?? 0) / 100).toFixed(2)} <Text style={s.currency}>AUD</Text></Text><Text style={s.body}>Каждый месяц</Text></View><View style={s.panel}><Text style={s.sectionTitle}>Последнее списание</Text><Text style={s.body}>{detail?.lastSeen}</Text><Text style={s.body}>Информация получена из отчета сервера. Это приложение не отменяет подписку.</Text></View><Button id="close-details" title="Закрыть карточку" onPress={() => setDetail(null)} /></ScrollView></SafeAreaView>
    </Modal>
  </SafeAreaView></SafeAreaProvider>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background }, scroll: { padding: 24, gap: 16, paddingBottom: 40, maxWidth: 640, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 24 }, brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { backgroundColor: c.ink, width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, brandLetter: { fontFamily: f.bold, fontSize: 22, color: c.white }, brandName: { fontFamily: f.bold, fontSize: 19, color: c.ink },
  headerAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }, headerActionText: { fontFamily: f.medium, fontSize: 13, color: c.primary },
  eyebrow: { fontFamily: f.bold, fontSize: 11, letterSpacing: 1.6, color: c.primary }, title: { fontFamily: f.bold, fontSize: 32, lineHeight: 41, color: c.ink },
  body: { fontFamily: f.regular, fontSize: 16, lineHeight: 25, color: c.muted, flexShrink: 1 }, sectionTitle: { fontFamily: f.bold, fontSize: 17, lineHeight: 25, color: c.ink, flexShrink: 1 },
  button: { backgroundColor: c.primary, borderRadius: 12, minHeight: 54, justifyContent: 'center', alignItems: 'center', padding: 16 }, buttonText: { fontFamily: f.bold, fontSize: 16, color: c.white, textAlign: 'center' }, secondary: { backgroundColor: c.tint },
  panel: { borderRadius: 16, backgroundColor: c.surface, padding: 20, gap: 16, borderWidth: 1, borderColor: c.border },
  preview: { padding: 24, backgroundColor: c.tint, borderRadius: 16, gap: 24, marginVertical: 8 }, previewLabel: { fontFamily: f.bold, fontSize: 11, letterSpacing: 1.5, color: c.primary }, previewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineLong: { height: 10, width: '48%', borderRadius: 12, backgroundColor: '#B6C7E2' }, lineMedium: { height: 10, width: '38%', borderRadius: 12, backgroundColor: '#B6C7E2' }, lineShort: { height: 10, width: '18%', borderRadius: 12, backgroundColor: c.primary }, previewDivider: { height: 1, backgroundColor: '#BCCCE3' }, previewFoot: { fontFamily: f.medium, fontSize: 14, color: c.ink },
  caption: { fontFamily: f.regular, fontSize: 13, lineHeight: 20, color: c.muted, textAlign: 'center' }, captionLeft: { fontFamily: f.regular, fontSize: 13, lineHeight: 20, color: c.muted }, info: { paddingVertical: 16, gap: 8 },
  fileBadge: { backgroundColor: c.tint, borderRadius: 12, alignSelf: 'flex-start', padding: 14 }, fileBadgeText: { fontFamily: f.bold, fontSize: 16, color: c.primary }, fileName: { fontFamily: f.bold, fontSize: 20, color: c.ink }, verified: { fontFamily: f.medium, fontSize: 14, color: c.success },
  progressTop: { flexDirection: 'row', alignItems: 'center', gap: 12 }, step: { flexDirection: 'row', alignItems: 'center', gap: 12 }, stepDot: { width: 12, height: 12, borderRadius: 12, backgroundColor: c.border }, stepDone: { backgroundColor: c.success },
  totalPanel: { backgroundColor: c.tint, borderRadius: 16, padding: 24, gap: 12 }, total: { fontFamily: f.bold, fontSize: 44, lineHeight: 58, color: c.ink, fontVariant: ['tabular-nums'] }, currency: { fontSize: 20, color: c.primary },
  payment: { padding: 20, borderRadius: 16, backgroundColor: c.surface, gap: 8, borderColor: c.border, borderWidth: 1 }, paymentTop: { flexDirection: 'row', alignItems: 'center', gap: 12 }, paymentIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.tint, justifyContent: 'center', alignItems: 'center' }, paymentInitial: { fontFamily: f.bold, fontSize: 20, color: c.ink }, paymentInfo: { flex: 1 }, paymentBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }, amount: { fontFamily: f.bold, fontSize: 20, color: c.ink, fontVariant: ['tabular-nums'] }, detailButton: { minHeight: 44, paddingVertical: 12, paddingHorizontal: 4, justifyContent: 'center' }, link: { fontFamily: f.bold, fontSize: 14, color: c.primary },
  errorPanel: { padding: 16, borderRadius: 12, backgroundColor: '#FBE9E8' }, errorText: { fontFamily: f.medium, fontSize: 15, lineHeight: 23, color: c.error }, successPanel: { padding: 20, borderRadius: 16, gap: 8, backgroundColor: '#E4F1E9' }, footer: { fontFamily: f.regular, fontSize: 12, lineHeight: 19, color: c.muted, textAlign: 'center', marginTop: 12 },
  input: { minHeight: 52, borderRadius: 12, backgroundColor: c.background, padding: 14, fontFamily: f.regular, color: c.ink, fontSize: 15 }, mono: { fontFamily: f.medium, fontSize: 15, lineHeight: 27, color: c.ink, fontVariant: ['tabular-nums'] }, notice: { fontFamily: f.medium, fontSize: 14, lineHeight: 22, color: c.primary },
});
