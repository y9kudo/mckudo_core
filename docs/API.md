# API MCKudo 0.2

Публичный вход — mckudo_core.js. Основные экспорты: createCore, MckudoCore, MckudoRuntime, definePlugin, validateConfig, ConfigError, matches, MCKUDO.

## Один агент

~~~js
const core = createCore({ config, adapter, memory });
await core.tick();
core.start();
await core.pause();
core.resume();
await core.stop();
~~~

config — результат чтения JSON или обычный объект. adapter реализует describe/observe/execute. memory необязательна. clock — необязательная функция времени для детерминированных тестов.

tick() выполняет один цикл наблюдение → выбор → действие. Одновременные вызовы используют общую блокировку. start() включает автоматический цикл; интервал начинается после завершения предыдущего шага. resume() снимает паузу, но не запускает отдельный таймер, если start() не использовался.

## Контракт отмены

Тайм-аут, pause и stop передают AbortSignal. Адаптер обязан реально остановить действие и завершить Promise. Ядро не запускает другую задачу до этого подтверждения. Если навык игнорирует сигнал, ожидание может продолжаться; библиотека не умеет принудительно остановить произвольный игровой поток.

## Наблюдаемость

snapshot() возвращает копию:
- observation — последние подтверждённые наблюдения;
- decision — выбранное правило или шаг и альтернативы;
- workflows — прогресс задач;
- plugins — подключённые наборы навыков;
- history — последние результаты;
- listenerErrors — последние десять ошибок подписчиков;
- engine — версия и авторство MCKudo.

При обычном правиле observation — снимок перед действием. При шаге с until он обновляется после действия для проверки результата.

~~~js
core.on('state', snapshot => render(snapshot));
core.on('action:start', decision => log(decision));
core.on('action:finish', result => persistResult(result));
~~~

События состояния изолируют ошибки подписчиков, включая отклонённые Promise: ошибка интерфейса не меняет результат игрового действия. Подписчики получают отдельные копии данных. Их асинхронные операции не задерживают игровой цикл; если требуется подтверждённое сохранение до следующего действия, вызывай tick и сохранение последовательно в своём цикле.

Результаты: success, failure, cancelled и progress. Последний означает, что действие выполнилось, но until ещё не достигнуто.

## Память

~~~js
import { FileMemory } from 'mckudo/memory';

const store = new FileMemory('./data/world-one.json');
const core = createCore({ config, adapter, memory: await store.load() });
await core.tick();
await store.save(core.exportMemory());
~~~

Сохранение явное. FileMemory использует временный файл и переименование; для одного файла должен быть один писатель. Повреждённый файл не затирается. worldId должен совпадать. Счётчики, история и прогресс задач сохраняются; инвентарь и игровой мир — нет.

Формат памяти 2 читается новой версией вместе со старым форматом 1. Новая память записывается в формате 2; обратная совместимость со старой библиотекой не гарантируется. Изменённые определения задач требуют явной миграции. [Подробности восстановления](WORKFLOWS.md).

## Игровой адаптер

~~~js
const adapter = {
  describe() {
    return {
      protocolVersion: 1, kind: 'custom', loader: 'vanilla',
      minecraftVersion: 'tested-version', skills: ['your-skill']
    };
  },
  async observe({ signal }) {
    signal.throwIfAborted();
    return { self: { health: 20 }, inventory: {} };
  },
  async execute({ skill, args }, { signal }) {
    // Реализуй фактическое действие через API игрового транспорта.
    throw new Error('Навык ещё не реализован.');
  }
};
~~~

В наблюдение передаётся обычный JSON, без сокетов и объектов классов. Максимальный размер — 256 КиБ. Адаптер объявляет только реализованные навыки. Неподдерживаемое действие блокируется с объяснением. Исключение или { ok: false, message } означают неудачу.

## Расширение

- registerSkill(name, handler, { validate }) — отдельный навык.
- use(plugin), removePlugin(id) — наборы навыков.
- resetWorkflow(id) — заново запустить всю задачу.
- retryStep(workflowId, stepId) — повтор ошибочного или прерванного шага.

Эти операции описаны в [плагинах](PLUGINS.md) и [задачах](WORKFLOWS.md). TypeScript-объявления входят в основной пакет. В ветке 0.x фиксируй точную версию зависимости.
