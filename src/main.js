import './style.css'
import { createRoomScene } from './scene/room.js'

const container = document.querySelector('#app')
const world = createRoomScene(container)
world.start()

world.ready.then(() => {
  document.body.classList.add('is-ready')
}).catch((error) => {
  console.error('《海风》模型加载失败', error)
  document.querySelector('.wind-loading__status').textContent = '画面加载失败，请刷新重试'
})

if (import.meta.env.DEV) window.__world = world
