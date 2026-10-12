const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createBrowserClient(script, stored = null) {
  const elements = new Map();
  const requests = [];
  const storage = new Map(stored ? [['kahoot.playerSession', JSON.stringify(stored)]] : []);
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      style: {}, disabled: false, value: '', innerText: '', children: [], listeners: {},
      addEventListener(name, handler) { this.listeners[name] = handler; },
      appendChild(child) { this.children.push(child); },
      click() { if (!this.disabled) return this.listeners.click?.(); }
    });
    return elements.get(id);
  }
  const options = Array.from({ length: 4 }, (_, i) => element(`option-${i}`));
  const socket = new EventEmitter();
  socket.connected = true;
  socket.timeout = (timeout) => ({
    emitWithAck(event, payload) {
      return new Promise((resolve, reject) => requests.push({ event, payload: structuredClone(payload), timeout, resolve, reject, handled: false }));
    }
  });
  socket.disconnect = () => { socket.connected = false; socket.emit('disconnect'); };
  socket.connect = () => { socket.connected = true; };
  const context = vm.createContext({
    io: () => socket,
    document: { getElementById: element, querySelectorAll: () => options, createElement: () => element(`created-${elements.size}`) },
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    console, alert() {}
  });
  vm.runInContext(readFileSync(path.join(__dirname, '..', 'public', 'js', script), 'utf8'), context);
  function next(event) {
    const request = requests.find((item) => !item.handled && item.event === event);
    if (!request) throw new Error(`No hay solicitud pendiente: ${event}`);
    request.handled = true;
    return request;
  }
  return {
    element, options, requests, socket, storage, next,
    evaluate: (code) => vm.runInContext(code, context),
    accept(event, data) { next(event).resolve({ ok: true, data: structuredClone(data) }); },
    reject(event, code, message = code) { next(event).resolve({ ok: false, error: { code, message } }); },
    timeout(event) { next(event).reject(new Error('operation has timed out')); }
  };
}

async function flushClient() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

module.exports = { createBrowserClient, flushClient };
