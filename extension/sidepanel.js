const URL_BASE = 'http://127.0.0.1:3939';
async function connect() {
  try {
    const r = await fetch(`${URL_BASE}/api/health`);
    if (!r.ok) throw new Error();
    document.getElementById('down').style.display = 'none';
    document.getElementById('frame').style.display = 'block';
    document.getElementById('frame').src = `${URL_BASE}/?embed=1`;
  } catch {
    document.getElementById('down').style.display = 'block';
    document.getElementById('frame').style.display = 'none';
  }
}
document.getElementById('retry').addEventListener('click', connect);
connect();
