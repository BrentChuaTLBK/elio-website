// Keep installed shortcuts and older links to a specific order working.
const destination = new URL('manage.html#pos', document.baseURI);
const params = new URLSearchParams(location.search);
for (const name of ['edit', 'delivery_receipt']) {
  if (params.has(name)) destination.searchParams.set(name, params.get(name));
}
location.replace(destination.href);
