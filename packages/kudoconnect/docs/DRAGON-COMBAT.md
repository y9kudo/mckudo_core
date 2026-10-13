# Ближний бой с Драконом Края

Когда дракон садится на портал, MCKudo может вызвать навык KudoConnect `attackDragon`. Клиент находит голову относительно наблюдаемого тела и поворота, берёт меч, дожидается отката атаки и бьёт именно часть «голова». В безопасных условиях он прыгает и пытается нанести удар при падении. Ответ содержит `damageConfirmed` по событию урона/изменению здоровья и отдельный `criticalAttempted`. Последнее поле сообщает о попытке крита, а не доказывает множитель урона.

```js
const dragon=client.observe().entities.find(entity=>entity.name==='ender_dragon');
if(dragon && [5,6,7].includes(dragon.phase)) {
  const result=await client.execute({
    skill:'attackDragon',args:{entityId:dragon.id,critical:true}
  });
  console.log(result.damageConfirmed,result.criticalAttempted);
}
```

Навык требует Minecraft Java 1.21.1, меч в инвентаре, наблюдаемую голову в пределах удара и свободную линию до неё. Он не ведёт агента к дракону: для полного поведения используйте `createDragonPolicy({client})` из MCKudo, который подбирает опору и маршрут. Если фаза изменилась, голова ушла из зоны досягаемости или путь закрыт, действие отменяется. [Игровой результат](https://github.com/y9kudo/mckudo_core/blob/main/docs/results/dragon-melee-2026-10-13.md) относится к подготовленному бою, не к прохождению с нуля.
