fetch('http://localhost:3000/api/legends/7045609b-cede-4509-b480-4d5a555f3fd7/reparse', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({})
})
.then(r => r.json())
.then(d => console.log(JSON.stringify(d, null, 2)))
.catch(e => console.error('ERR:', e.message));
