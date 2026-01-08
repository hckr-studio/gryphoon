export function transform(el, transformations) {
  if (!el) return;
  for (const [selector, props] of Object.entries(transformations)) {
    const target = el.querySelector(selector);
    if (typeof props === "function") {
      props(target);
      continue;
    }
    for (const [key, val] of Object.entries(props)) {
      if (typeof val === "function") val(target[key]);
      else target[key] = val;
    }
  }
}

/**
 * @param {Element} section
 * @param {Array} items
 */
function itemsCounter(section, items) {
  transform(section, {
    data: {
      value: items.length,
      textContent: `${items.length}x`,
    },
  });
}

/**
 * @param {Element} section
 * @param {HTMLTemplateElement} template
 * @param {Array} items
 * @param {Function} applyTemplate
 */
export function injectItems(section, template, items, applyTemplate) {
  if (!items?.length) {
    return section.remove();
  }
  itemsCounter(section, items);
  if (!template) return;

  const list = section.querySelector(".items");
  const listItems = section.ownerDocument.createDocumentFragment();
  for (const item of items) {
    const content = template.content.cloneNode(true);
    applyTemplate(content, item, section);
    listItems.appendChild(content);
  }
  list.replaceChildren(listItems);
}
