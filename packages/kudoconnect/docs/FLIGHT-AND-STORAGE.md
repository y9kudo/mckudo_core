# Полёт и операции с хранилищами

KudoConnect исполняет физические действия. Распределение предметов по категориям находится в MCKudo Core; самостоятельному KudoConnect можно передать любые правила своего приложения.

```js
import {createKudoConnect} from 'kudoconnect'

const client = createKudoConnect({
  host: '127.0.0.1', port: 25565,
  username: 'Avery07', version: '1.21.1', auth: 'offline'
})
try {
  await client.connect()
  console.log(client.findSigns({text: 'Elytra'}))
  console.log(await client.findStorages({radius: 64}))

  const chest = {x: 10, y: 64, z: 20} // замените координаты на свои
  console.log(await client.execute({skill: 'inspectStorage', args: chest}))
  await client.execute({skill: 'takeStorage', args: {...chest, amounts: {elytra: 1, firework_rocket: 8}}})

  const goal = {x: 90, y: 64, z: 20} // площадка должна быть видима и свободна
  const plan = client.vectorize.planFlight({start: client.state.position, goal})
  if (plan.status === 'planned') {
    console.log(await client.execute({skill: 'fly', args: {position: goal}}))
  }

  await client.execute({skill: 'depositStorage', args: {...chest, amounts: {oak_log: 4}}})
  await client.execute({skill: 'labelStorage', args: {...chest, lines: ['Дерево', 'MCKudo']}})
} finally {
  await client.close()
}
```

`takeStorage` и `depositStorage` принимают `items` (все совпадающие стаки), `amounts` (точные количества) или `all:true`. Они ждут изменения исходного и целевого инвентарей, не объявляя успех до ответа сервера. `labelStorage` использует существующую пустую табличку либо ставит новую рядом или сверху; чужие надписи не переписывает. Планировщик полёта проверяет прямой воздушный коридор и площадку 7×7, а исполнитель сверяет раскрытие элитр, ракету и посадку. Готовые модели наблюдения и тесты находятся в пакете.
