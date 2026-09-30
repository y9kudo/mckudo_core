# Первое приложение на MCKudo Core 0.5.0

Автор: **y9kudo**, лицензия MIT. MCKudo — библиотека принятия решений для Minecraft. KudoConnect — библиотека подключения, наблюдения мира и исполнения действий. Вы создаёте приложение, которое соединяет эти два слоя.

## 1. Подготовьте окружение

Установите Node.js 22 или новее и Git. Откройте терминал VS Code. Для игровых примеров нужен свой сервер **Minecraft Java 1.21.1**, принимающий offline-подключения. Сервер должен быть запущен до старта примера. Адрес этого компьютера — `127.0.0.1`; стандартный порт — `25565`. В мире, открытом по LAN, используйте порт, показанный Minecraft.

```powershell
git clone https://github.com/y9kudo/mckudo_core.git
cd mckudo_core
npm.cmd ci
npm.cmd test
```

`npm.cmd` работает в PowerShell без изменения политики запуска сценариев. Эти тесты проверяют код и модели; они не подключают игроков к серверу.

## 2. Подключите одного агента

Создайте в корне проекта файл `my-agent.js`:

```js
import { createKudoConnect } from './kudoconnect/index.js';
import { createMinecraftBrain } from './mckudo_core.js';

const client = createKudoConnect({
  username: 'Alice', host: '127.0.0.1', port: 25565,
  version: '1.21.1', auth: 'offline',
  maxDrop: 16, fallHealthReserve: 6, maxFallDamage: 6
});
let brain;
process.once('SIGINT', async () => {
  await brain?.stop();
  await client.close();
});
try {
  await client.connect();
  brain = createMinecraftBrain({
    client, worldId: 'my-local-world',
    storage: false,
    survival: { target: 'stone_tools' }
  });
  brain.on('action:finish', event => console.log(event));
  brain.start();
} catch (error) {
  await brain?.stop();
  await client.close();
  console.error(error.message);
}
```

Запустите `node my-agent.js`. Для остановки нажмите **Ctrl+C**. Агент выбирает древесину из доступных пород, готовит инструменты и станции. Решения находятся в ядре; пример задаёт профиль и запускает цикл.

`worldId` — ваша постоянная метка конкретного мира. `storage: false` отключает сбор из чужих хранилищ в этом примере; стандартный профиль умеет искать сундуки и забирать доступное содержимое. Для трёх агентов с распределением лишнего снаряжения используйте [менеджер и веб-панель](DASHBOARD.md), а не три несвязанных процесса.

## 3. Задавайте задачи данными

Простой JSON-сценарий состоит из этапов и условий их завершения:

```json
{
  "schemaVersion": 1,
  "name": "Инструменты",
  "steps": [
    {
      "id": "stone-tools",
      "type": "resources",
      "targets": { "minecraft:stone_pickaxe": 1, "minecraft:furnace": 1 }
    }
  ]
}
```

`id` — уникальное имя этапа; `type` выбирает обработчик; `targets` задаёт требуемые предметы и количества. `minecraft:` — пространство имён vanilla. Можно читать JSON через `readFile` и передавать в `createScenario`; для нативной ресурсной политики передайте `resourceFactory`, создающий `createSurvivalReactor`. Готовая связка уже используется в `createEndExpedition`. [Полный формат и примеры](SCENARIOS.md).

Для обычной задачи производства достаточно `createMinecraftBrain({ ..., survival: { targets: { iron_pickaxe: 1 } } })`. Усложнять сценарий ради одного предмета не требуется.

## 4. Используйте библиотеку в другом проекте

В папке MCKudo выполните `npm.cmd pack`. В своём проекте:

```powershell
npm.cmd init -y
npm.cmd pkg set type=module
npm.cmd install C:/путь/к/mckudo-0.5.0.tgz
```

Импорты теперь выглядят так:

```js
import { createMinecraftBrain } from 'mckudo';
import { createKudoConnect } from 'mckudo/connect';
```

KudoConnect уже вложен в этот архив. Для использования транспорта без мозга возьмите [самостоятельный репозиторий](https://github.com/y9kudo/kudoconnect), соберите его архив и импортируйте `createKudoConnect` из `kudoconnect`. Публикация этих версий в npm пока не выполнялась.

## 5. Где искать нужный модуль

| Задача | Модуль / руководство |
| --- | --- |
| Каталог, классы дерева/руд, рецепты | [AUTOMATION](AUTOMATION.md), `src/catalog.js`, `src/taxonomy.js` |
| Производство, добыча, станции | [NATIVE-SURVIVAL](NATIVE-SURVIVAL.md), `src/survival-brain.js` |
| Броня, еда, сон, охота | `equipment-policy.js`, `needs.js`, `rest-policy.js`, `hunting.js` в `src/` |
| Передачи с подтверждением, распределение запасов | `src/trade.js`, `src/cooperation.js` |
| Соединение, физика, серверные действия | [API KudoConnect](../packages/kudoconnect/docs/API.md) |
| Расчёт падения и движение | [движение KudoConnect](../packages/kudoconnect/docs/CRAFTING-MOVEMENT.md) |
| Этапы пути до Энда | [END-EXPEDITION](END-EXPEDITION.md), `src/expedition.js` |
| Результаты проверок | [TESTING-05](TESTING-05.md) |

Если действие не удалось, сначала смотрите `action:finish`, `client.trace` и причину текущего этапа. Неизвестный чанк не считается пустым, отправленный пакет не считается подтверждённым результатом. Дальность наблюдения ограничена чанками, которые реально прислал сервер.
