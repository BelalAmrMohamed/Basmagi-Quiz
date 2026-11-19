const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 2"/></svg>`;
try {
  const u = new URL(s, "http://example.com");
  console.log("ok", u.origin, u.pathname.slice(0, 60));
} catch (e) {
  console.log("throw", e.name, e.message);
}
