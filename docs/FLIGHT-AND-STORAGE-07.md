# Полёт и складирование в 0.7

Оба навыка работают через KudoConnect с Minecraft Java 1.21.1. Решение о группировке предметов находится в MCKudo Core, а расчёт безопасного воздушного коридора — в KudoVectorize. На локальном сервере используется вход `offline`.

## Быстрый запуск испытаний

Откройте терминал VS Code в корне `mckudo_core`. В PowerShell используйте `npm.cmd`:

```powershell
npm.cmd ci
npm.cmd run test:live:flight-storage:survey
npm.cmd run test:live:flight
npm.cmd run test:live:storage
```

Сервер: `127.0.0.1:25565`, Java 1.21.1, offline, свободные места для `Avery07` и `Scout07`. Команда `survey` только осматривает таблички, хранилища и возможные места посадки. `flight` берёт **одну** пару элитр и ровно восемь ракет из сундука с табличкой `Elytra`, автоматически выбирает наблюдаемую площадку и летит к ней. `Scout07` независимо наблюдает раскрытие элитр и движение. `storage` находит сундук с табличкой `Random`, использует пустые сундуки поблизости, размещает подписи и раскладывает предметы.

Если сервер другой, задайте `MCKUDO_HOST`, `MCKUDO_PORT` и `MCKUDO_NAME` в окружении. Пример сохраняет подробный JSON в локальный `data/`; эта папка не публикуется. Повторный `storage` продолжает работу с предметами в инвентаре `Avery07`, сохраняя его ракеты.

## Использование навыков в своём коде

```js
import {createKudoConnect} from 'mckudo/connect'
import {findLabelledStorage, sortStorage} from 'mckudo'

const client = createKudoConnect({
  host: '127.0.0.1', port: 25565,
  username: 'Avery07', version: '1.21.1', auth: 'offline'
})

try {
  await client.connect()
  const equipmentChest = findLabelledStorage(client, 'Elytra')
  await client.execute({
    skill: 'takeStorage',
    args: {...equipmentChest, amounts: {elytra: 1, firework_rocket: 8}}
  })

  // Координаты точки посадки берите из survey или из собственного планировщика.
  const goal = {x: 41, y: 64, z: -70}
  const route = client.vectorize.planFlight({start: client.state.position, goal})
  if (route.status !== 'planned') throw new Error(route.reason)
  const flight = await client.execute({skill: 'fly', args: {position: goal}})
  console.log(flight.landingError, flight.rocketsUsed)

  const warehouse = await sortStorage(client, {sourceLabel: 'Random'})
  console.log(warehouse.status, warehouse.conserved)
} finally {
  await client.close()
}
```

Значение `goal` в этом фрагменте — пример для конкретного мира. Для своей карты сначала выполните `survey`. Маршрут полёта проверяет загруженные блоки и ровную площадку 7×7; если блоки неизвестны или посадка занята, он не начинает полёт. Исполнитель отслеживает состояние элитр и ракеты через серверные пакеты, а после посадки сверяет позицию и здоровье.

Для точного переноса можно использовать `client.execute({skill:'depositStorage', args:{x,y,z,amounts:{oak_log:7}}})`. `takeStorage` работает так же в обратном направлении. `inspectStorage` возвращает содержимое без переноса, а `labelStorage` принимает `lines:['Материалы','MCKudo']` и подтверждает написанное по серверному NBT. Старую пользовательскую надпись автоматическая сортировка не переписывает. Для повторного запуска после обрыва укажите `resumeInventory:true` и перечислите собственные предметы агента в `preserveItems`, например `['firework_rocket']`.

MCKudo распределяет предметы по шести категориям: строительство, материалы, снаряжение, еда, растения и дроп, разное. Для каждой категории нужен отдельный доступный сундук. Из уже занятых сундуков ядро выбирает только те, которые ранее подписало само. Перенос подтверждается уменьшением исходного стека и увеличением целевого; итоговый проход сравнивает числа и проверяет отсутствие смешения категорий. Таблички расходуются как обычные предметы.

[Итоги двух испытаний](results/flight-storage-2026-10-12.md) описывают фактически наблюдённые пакеты, количество предметов и найденные исправления.
