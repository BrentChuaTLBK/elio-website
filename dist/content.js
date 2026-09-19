/* Add flavors to this list to include them in the carousel and full catalog automatically.
   Optional fields: image: 'assets/flavor.webp', available: false.
   Unavailable flavors remain browsable and show a status label; this is not live inventory.
   Replace image paths here and in index.html. Concept images are not final product photography. */
window.ELIO_CONTENT = {
  productImage: 'assets/flavors-concept.webp',
  flavors: [
    { id: 'vanilla', name: 'Vanilla', line: 'Classic and Creamy', description: 'Made with fragrant vanilla seeds and a touch of sea salt. Smooth, creamy, and timeless.', imagePosition: '0%', featured: true },
    { id: 'gorgonzola', name: 'Gorgonzola', line: 'Sweet and Savory', description: 'Made with Gorgonzola Dolce and a hint of vanilla, balancing creamy sweetness with a gentle blue-cheese tang.' },
    { id: 'chocolate', name: 'Chocolate', line: 'Dark and Silky', description: 'Made with 54.5% Belgian dark chocolate for a rich, smooth taste and a gently bittersweet finish.', imagePosition: '100%', featured: true },
    { id: 'ube', name: 'Ube', line: 'Rich and Velvety', description: 'Made with 100% real ube, topped with ube halaya blended with coconut cream and finished with desiccated coconut.' },
    { id: 'matcha', name: 'Matcha', line: 'Earthy and Bold', description: 'Made with Japanese matcha green tea, balancing its earthy flavor and gentle bitterness with the richness of cream cheese.', imagePosition: '50%', featured: true },
    { id: 'hojicha', name: 'Hojicha', line: 'Toasted and Mellow', description: 'Made with roasted Japanese green tea for a warm, toasted flavor and a smooth, subtly nutty finish.' },
    { id: 'speculoos', name: 'Speculoos', line: 'Caramelized and Spiced', description: 'Made with caramelized biscuit spread for warm, spiced sweetness, balanced with a touch of sea salt.' }
  ],
  // These lead the carousel; all other flavors follow automatically.
  featuredOrder: ['vanilla', 'matcha', 'chocolate']
};
