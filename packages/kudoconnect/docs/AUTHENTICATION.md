# Microsoft Auth

KudoConnect принимает `auth: 'offline'` и `auth: 'microsoft'`. Microsoft-вход использует `minecraft-protocol` и его `prismarine-auth`: OAuth-поток по коду, Xbox Live/XSTS и получение профиля Minecraft Java. Mineflayer не используется.

## Первый вход

```js
import {createKudoConnect} from 'kudoconnect';

const client=createKudoConnect({
  host:'your-server.example', version:'1.21.1',
  auth:'microsoft', username:'my-account',
  profilesFolder:'.cache/kudoconnect/auth',
  authTimeoutMs:180000,
  onMsaCode:({verification_uri,user_code})=>{
    console.log('Открой',verification_uri,'и введи код',user_code);
  }
});
try {
  await client.connect();
  console.log(client.snapshot().authentication);
} finally {
  await client.close();
}
```

`username` здесь — постоянное имя записи кэша, например `my-account`. Игровой ник берётся из подтверждённого профиля Microsoft. В `offline` это именно игровой ник, допускающий 1–16 латинских букв, цифр и `_`.

Владелец аккаунта открывает страницу Microsoft и завершает вход самостоятельно. Пароль, `session` и `accessToken` в настройках Microsoft отклоняются. Код выдаёт провайдер; KudoConnect не генерирует фиктивные коды и не переключается на offline при ошибке.

`authTimeoutMs` ограничивает ожидание профиля отдельно от `connectTimeoutMs`, ограничивающего вход в мир. `close()` не позволяет завершившемуся позже OAuth-процессу открыть новое игровое соединение. Сетевой запрос внутри провайдера может завершиться позднее; это не возобновляет клиента.

Кэш содержит секреты, позволяющие повторный вход. Папка `.cache/` исключена из Git; её нельзя включать в публичные отчёты. `snapshot().authentication` содержит только режим, состояние и игровой профиль. Событие `authenticated` содержит имя/UUID, `authCode` — короткий пользовательский код и адрес входа; полный `device_code` не передаётся. Не логируйте внутренний объект `client.client.session`.

Готовый пример: [microsoft.js](../examples/microsoft.js). Из каталога библиотеки:

```powershell
$env:MC_HOST="your-server.example"
node examples/microsoft.js
```

## Realms и версии

`realms: {realmId: 123456}` передаёт явный ID доступного Realm провайдеру; требуется Microsoft Auth. Выбор чужого Realm или обход приглашения не предусмотрен. Нативный игровой профиль KudoConnect остаётся Java 1.21/1.21.1. Realms с другой версией и конкретные публичные серверы не объявлены проверенными: наличие авторизации не обеспечивает совместимость их протокола и интерфейсов.

Источники: [документация Microsoft Device Authorization Grant](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code), [API minecraft-protocol](https://github.com/PrismarineJS/node-minecraft-protocol/blob/master/docs/API.md), [реализация Microsoft Auth](https://github.com/PrismarineJS/node-minecraft-protocol/blob/master/src/client/microsoftAuth.js). Проверки в проекте подтверждают обработку профиля, отмену и отсутствие токенов в снимках с моделируемым провайдером; настоящий Microsoft-вход пока не выполнен.
