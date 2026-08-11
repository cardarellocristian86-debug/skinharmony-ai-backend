let csrfToken = '';

const initialization = document.querySelector('#initialization');
const signing = document.querySelector('#signing');
const result = document.querySelector('#result');
const output = document.querySelector('#output');

function showResult(value) {
  result.classList.remove('hidden');
  output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

async function api(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Genesis-CSRF': csrfToken },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || 'request_failed');
  return data;
}

async function load() {
  const response = await fetch('/api/session', { cache: 'no-store' });
  const session = await response.json();
  csrfToken = session.csrf_token;
  if (session.initialized) signing.classList.remove('hidden');
  else initialization.classList.remove('hidden');
}

document.querySelector('#initialize').addEventListener('click', async () => {
  try {
    const data = await api('/api/initialize', {
      pin: document.querySelector('#new-pin').value,
      pin_confirmation: document.querySelector('#new-pin-confirmation').value
    });
    document.querySelector('#new-pin').value = '';
    document.querySelector('#new-pin-confirmation').value = '';
    initialization.classList.add('hidden');
    signing.classList.remove('hidden');
    showResult({ initialized: true, public_material: data.public_material });
  } catch (error) {
    showResult({ error: error.message });
  }
});

document.querySelector('#sign').addEventListener('click', async () => {
  try {
    const receipt = JSON.parse(document.querySelector('#receipt').value);
    const data = await api('/api/sign', { receipt, pin: document.querySelector('#pin').value });
    document.querySelector('#pin').value = '';
    showResult(data);
  } catch (error) {
    document.querySelector('#pin').value = '';
    showResult({ error: error.message });
  }
});

load().catch((error) => showResult({ error: error.message }));
