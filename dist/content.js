/* Add flavors to the catalog, then add their IDs to monthlyMenu when in rotation.
   Optional fields: image: 'assets/flavor.webp', category: 'classic' | 'tea' | 'rich', available: false.
   Flavors outside monthlyMenu stay browsable but cannot be selected in the box preview.
   available: false overrides the monthly menu; this editorial list is not live inventory.
   Replace image paths here and in index.html. Concept images are not final product photography. */
window.ELIO_CONTENT = {
  productImage: 'assets/flavors-concept.webp',
  // Reference-inspired box concepts. Prices and final combinations are unconfirmed.
  boxCollections: [
    { id: 'signature', name: 'The Signature Trio', flavors: ['vanilla', 'chocolate', 'matcha'], line: 'Three favorites, beautifully boxed.', image: 'assets/trio-story-concept.webp' },
    { id: 'tea', name: 'The Tea Collection', flavors: ['vanilla', 'matcha', 'hojicha'], line: 'A little calm. A lovely trio.', image: 'assets/shop-tea-box-concept.webp' },
    { id: 'discovery', name: 'The Discovery Box', flavors: ['ube', 'gorgonzola', 'speculoos'], line: 'Something a little unexpected.', image: 'assets/shop-discovery-box-concept.webp' },
    { id: 'your-own', name: 'Build your own box', flavors: [], line: 'Choose your three favorites.', image: 'assets/shop-custom-box-concept.webp', customizable: true }
  ],
  // All current flavors are in the initial lineup, as confirmed by Elio.
  monthlyMenu: ['vanilla', 'matcha', 'chocolate', 'gorgonzola', 'ube', 'hojicha', 'speculoos'],
  flavors: [
    { id: 'vanilla', category: 'classic', name: 'Vanilla', line: 'Classic and Creamy', description: 'Made with fragrant vanilla seeds and a touch of sea salt. Smooth, creamy, and timeless.', imagePosition: '0%', featured: true },
    { id: 'gorgonzola', category: 'classic', name: 'Gorgonzola', line: 'Sweet and Savory', description: 'Made with Gorgonzola Dolce and a hint of vanilla, balancing creamy sweetness with a gentle blue-cheese tang.' },
    { id: 'chocolate', category: 'rich', name: 'Chocolate', line: 'Dark and Silky', description: 'Made with 54.5% Belgian dark chocolate for a rich, smooth taste and a gently bittersweet finish.', imagePosition: '100%', featured: true },
    { id: 'ube', category: 'rich', name: 'Ube', line: 'Rich and Velvety', description: 'Made with 100% real ube, topped with ube halaya blended with coconut cream and finished with desiccated coconut.' },
    { id: 'matcha', category: 'tea', name: 'Matcha', line: 'Earthy and Bold', description: 'Made with Japanese matcha green tea, balancing its earthy flavor and gentle bitterness with the richness of cream cheese.', imagePosition: '50%', featured: true },
    { id: 'hojicha', category: 'tea', name: 'Hojicha', line: 'Toasted and Mellow', description: 'Made with roasted Japanese green tea for a warm, toasted flavor and a smooth, subtly nutty finish.' },
    { id: 'speculoos', category: 'rich', name: 'Speculoos', line: 'Caramelized and Spiced', description: 'Made with caramelized biscuit spread for warm, spiced sweetness, balanced with a touch of sea salt.' }
  ],
  // These lead the carousel; all other flavors follow automatically.
  featuredOrder: ['vanilla', 'matcha', 'chocolate']
};

// Read the current data each time so every page follows the same rotation.
window.ELIO_CONTENT.isAvailable = (flavor) =>
  flavor.available !== false && window.ELIO_CONTENT.monthlyMenu.includes(flavor.id);
