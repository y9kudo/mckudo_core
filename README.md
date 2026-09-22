# MCKudo Core

**Платформа автоматизации Minecraft · v0.2.0 · автор y9kudo · MIT**

MCKudo — самостоятельная библиотека, в которой разработчик описывает поведение через JSON, подключает игровые адаптеры и добавляет собственные навыки. Она подходит для сбора ресурсов, производственных цепочек, обслуживания игровых механизмов и координации нескольких агентов.

Главный публичный файл — **mckudo_core.js**, локальное имя npm-пакета — **mckudo**. Пакет пока не опубликован в npm или GitHub.

## Возможности 0.2

| Возможность | Что делает |
|---|---|
| Реактивные правила | Выбирает действие по наблюдаемым фактам и приоритету |
| Многошаговые задачи | Выполняет граф зависимостей, проверяет результат каждого шага |
| Повторы и остановка | Ограничивает попытки, выдерживает паузу после ошибки, учитывает отмену |
| Память прогресса | Возобновляет незавершённые задачи, сохраняет завершённые этапы |
| Плагины | Подключает наборы навыков, проверяет зависимости и аргументы |
| Runtime нескольких агентов | Ограничивает параллельную работу и защищает заявленные игровые ресурсы от дублирования |
| Наблюдаемость | Предоставляет состояние, план, историю, прогресс задач и ошибки подписчиков |
| CLI | Создаёт самостоятельный проект, проверяет JSON и запускает симуляцию |

Симулятор поддерживает небольшую проверяемую цепочку ресурсов. Отдельный адаптер Mineflayer предоставляет eat, gather и goto. Для Forge/NeoForge предусмотрен bridge-интерфейс, но игровые Java-моды и готовые .jar ещё не реализованы. [Матрица интеграций](docs/MODS.md).

## Первый самостоятельный сценарий

Нужен Node.js 22 или новее. Открой папку mckudo_core в VS Code и выполни:

~~~powershell
npm.cmd run demo:workflow
~~~

Пример собирает брёвна, изготавливает доски, затем верстак и палки. Это **локальная симуляция**: сервер и игровой аккаунт не требуются.

Поведение находится в **examples/workshop.json**. Простой фрагмент:

~~~json
{
  "id": "prepare-materials",
  "steps": [
    {
      "id": "logs",
      "action": { "skill": "gather", "args": { "block": "minecraft:oak_log", "count": 1 } },
      "until": { "fact": "/inventory/minecraft:oak_log", "gte": 2 }
    },
    {
      "id": "boards",
      "action": { "skill": "craft", "args": { "item": "minecraft:oak_planks", "times": 2 } },
      "until": { "fact": "/inventory/minecraft:oak_planks", "gte": 8 }
    }
  ]
}
~~~

Шаг boards по умолчанию зависит от предыдущего шага logs. until задаёт наблюдаемый результат: ядро не считает этап готовым только потому, что функция действия завершилась.

~~~powershell
npm.cmd run cli -- validate examples/workshop.json
npm.cmd run cli -- simulate examples/workshop.json --steps 10
npm.cmd test
~~~

## Создание своего проекта

Из папки исходников библиотеки:

~~~powershell
npm.cmd run cli -- init ../my-automation
~~~

Появится новая папка с agent.json, index.js и package.json. Существующая папка не перезаписывается. Затем установи библиотеку в этот проект:

~~~powershell
cd ../my-automation
npm.cmd install ../mckudo_core
npm.cmd start
~~~

Сгенерированный проект использует симулятор. Для настоящего мира разработчик подключает игровой адаптер. [Полный учебник JSON](docs/JSON.md).

## Импорт API

~~~js
import { readFile } from 'node:fs/promises';
import { createCore } from 'mckudo';
import { createSimulator } from 'mckudo/adapters/simulator';

const config = JSON.parse(await readFile('./agent.json', 'utf8'));
const core = createCore({ config, adapter: createSimulator() });

core.on('action:finish', result => console.log(result));
await core.tick();
console.log(core.snapshot().workflows);
await core.stop();
~~~

Для непрерывного цикла используется core.start(), для одного шага — core.tick(). Многошаговые задачи выполняются один раз до завершения; повторный запуск задаётся явно через resetWorkflow().

## Примеры

~~~powershell
npm.cmd run demo
npm.cmd run demo:workflow
npm.cmd run demo:plugins
npm.cmd run demo:runtime
~~~

- **examples/agent.json** — реактивный сбор ресурсов.
- **examples/workshop.json** — цепочка подготовки мастерской.
- **examples/plugin.js** — собственный модуль навыков.
- **examples/runtime.js** — три независимых агента с лимитом параллельности.
- **examples/mineflayer.js** — подключение внешнего Minecraft-клиента через Mineflayer.

## Документация

- [JSON и условия](docs/JSON.md)
- [Задачи, зависимости, восстановление](docs/WORKFLOWS.md)
- [Плагины и навыки](docs/PLUGINS.md)
- [Несколько агентов](docs/RUNTIME.md)
- [API и память](docs/API.md)
- [Forge, NeoForge, Fabric](docs/MODS.md)
- [GitHub и npm](docs/PUBLISHING.md)
- [Изменения версии](CHANGELOG.md)
- [План развития](ROADMAP.md)

Ядро не имеет внешних runtime-зависимостей. TypeScript-описания основного API входят в пакет. Формат конфигурации 1 продолжает работать; многошаговые задачи используют формат 2.

**MCKudo Core · разработано y9kudo**
