# Плагины навыков

Плагин — JavaScript-модуль с набором навыков. Его подключает приложение; JSON только выбирает зарегистрированное действие. Ядро не скачивает и не исполняет произвольные модули из конфигурации.

~~~js
import { definePlugin } from 'mckudo';

export const inventoryTools = definePlugin({
  id: 'inventory-tools',
  apiVersion: 1,
  skills: {
    'inventory-tools:report': {
      validate: args =>
        typeof args.label === 'string' || 'Нужна строка label.',
      async execute(args, { signal, observation }) {
        signal.throwIfAborted();
        console.log(args.label, observation.inventory);
        return { ok: true };
      }
    }
  }
});
~~~

Подключение: core.use(inventoryTools). После этого имя inventory-tools:report доступно в action.skill.

validate получает копию args. false или строка означают ошибку аргументов; true или undefined разрешают выполнение. Проверка может быть асинхронной, но не должна сама изменять мир. execute получает signal и снимок наблюдения. Исключение либо { ok: false, message } означает неудачу.

Для одного навыка доступно core.registerSkill(name, handler, { validate }). Плагин удобнее, когда навыки распространяются вместе.

## Зависимости и конфликты

requires: ["base-plugin"] требует, чтобы указанные плагины уже были подключены. Самозависимости, дубликаты ID и конфликтующие имена навыков запрещены. Проверка выполняется до регистрации: при ошибке половина навыков не останется установленной.

core.removePlugin(id) удаляет набор навыков, если от него никто не зависит и текущий шаг завершён. Во время исполняемого действия подключение и удаление плагинов запрещены. Внешними соединениями плагина управляет приложение: use/removePlugin сами их не создают и не закрывают.

Плагины исполняются в процессе Node.js и не являются изолированной песочницей. Их следует подключать как обычные доверенные зависимости приложения.

Список установленного доступен в snapshot().plugins. Пример: npm.cmd run demo:plugins.
