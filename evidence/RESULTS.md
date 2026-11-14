Результаты проверки 14 ноября 2026

Окружение

Android 15 API 35, arm64 emulator, 1080 на 1920 px при density 480, 360 на 640 dp. iOS 27.2 Simulator iPhone 17e, 390 на 844 pt. Maestro 2.12.1. Обе сборки release с JS внутри приложения. Проверки выполнены с исходным HTTP mock.

Основной сценарий

Android принял CSV 112 байт. iOS принял PDF 33882 байта. На обоих показаны 151.99 AUD, StreamBeam, BrightGrid и даты 2026-10-01 и 2026-10-03. Оба импорта удалены с подтверждением GET deleted revision 5. Суммарный серверный снимок happy-server-state.json содержит 2 POST, 2 job и 33994 байта. SHA-256 совпадает с оригиналами.

Сценарии Android

lost_ack. После остановки и запуска приложения восстановлен готовый отчет. POST 1, newJobs 1, acceptedBytes 112. Временных копий 0. Снимок android-lost-server.json.

stale_status. Ревизия осталась 3. Диагностика показала 1 отброшенный ответ. Отчет сохранил сумму 151.99 AUD. Снимок android-stale-server.json.

delete_failure. После 503 показано Данные еще не удалены. Это состояние сохранилось после relaunch. После смены режима на happy повтор завершился GET deleted revision 5. DELETE 2, job 1. Стабильность ключа дополнительно проверена HTTP тестом. Снимок android-delete-server.json.

spoofed.pdf и oversize.csv. Оба отклонены локально. POST 0, newJobs 0, acceptedBytes 0, временных копий 0. Снимок android-invalid-server.json.

Отмена. Проверены закрытие системного picker, relaunch после выбора до отправки, отмена выбора. POST 0, newJobs 0, временных копий 0. Снимок android-cancel-server.json.

Крупный шрифт. При font_scale 2.0 пройден полный happy сценарий с обеими карточками и удалением. Все кнопки доступны через прокрутку. После теста восстановлено исходное значение. Снимок android-large-server.json.

Дополнительная проверка iOS

Поддельный PDF и CSV больше 10 МиБ выбраны через Files и отклонены до POST. POST 0, newJobs 0, acceptedBytes 0, временных копий 0. Снимок ios-invalid-server.json, видео videos/ios-invalid.mp4.

Автотесты и установка

15 тестов клиента, 6 исходных тестов mock, TypeScript и проверка целостности 9 исходных файлов прошли. npm ci, тесты, TypeScript и проверка набора повторены в отдельной чистой папке. Логи clean-install-tests.txt, unit-tests.txt, mock-tests.txt, typecheck.txt, kit-integrity.txt.

Видео

videos/statement-demo.mp4. 2 минуты 46 секунд, без звука. Начинается сразу с приложения. Сценарии не имитируются в UI, все запросы идут в локальный HTTP mock.

00:00 Android happy
00:33 iOS happy
01:01 Android lost_ack и relaunch
01:28 Android stale_status
02:02 Android delete_failure и повтор

Оригинальные отдельные клипы сохранены рядом. В screenshots находятся реальные снимки проверенных экранов. Полные технические артефакты Maestro создаются при повторном запуске e2e и исключены из Git.

Границы

Физические устройства не проверялись. Отказные сетевые сценарии на iOS отдельно не прогонялись. API 37 не считается проверенным. Предупреждения npm audit зафиксированы в dependency-audit.json и описаны в RELEASE.md.
