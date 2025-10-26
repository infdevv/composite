const log = console.log;
const error = console.error;
const info = console.info;
const warn = console.warn;
window.logs = [];
console.log = (...args) => {
  log(...args);
  const message = args
    .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
    .join(" ");
  window.logs.push("LOG: " + message);
  document.getElementById(
    "logs"
  ).innerHTML += `<span>log: ${message}</span><br>`;
};

console.error = (...args) => {
  error(...args);
  const message = args
    .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
    .join(" ");
  window.logs.push("ERROR: " + message);
  document.getElementById(
    "logs"
  ).innerHTML += `<span style="color: red">error: ${message}</span><br>`;
};

console.info = (...args) => {
  info(...args);
  const message = args
    .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
    .join(" ");
  window.logs.push("INFO: " + message);
  document.getElementById(
    "logs"
  ).innerHTML += `<span style="color: yellow">info: ${message}</span><br>`;
};

console.warn = (...args) => {
  warn(...args);
  const message = args
    .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
    .join(" ");
  window.logs.push("WARN: " + message);
  document.getElementById(
    "logs"
  ).innerHTML += `<span style="color: orange">warn: ${message}</span><br>`;
};

// export console functions
window.log = log;
window.error = error;
window.info = info;
window.warn = warn;