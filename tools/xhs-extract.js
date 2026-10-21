JSON.stringify([...document.querySelectorAll('section.note-item')].slice(0,__LIMIT__).map((s) => {
  const link = s.querySelector('a[href*="/search_result/"]');
  const lines = (s.innerText || '').split('\n').map((x) => x.trim()).filter(Boolean);
  return { title: lines[0] || '', author: lines[1] || '', date: lines[2] || '', likes: lines[3] || '',
           noteId: s.getAttribute('data-note-id') || '', url: link ? link.href : '' };
}))
