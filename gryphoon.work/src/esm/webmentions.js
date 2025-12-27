import { injectItems, transform } from "./lib/dom.js";

function groupByType(webmentions) {
  if (typeof Map.groupBy === "function") return Map.groupBy(webmentions, x => x["wm-property"]);
  const byType = new Map();
  for (const post of webmentions) {
    const key = post["wm-property"];
    const values = byType.get(key) ?? [];
    values.push(post);
    byType.set(key, values);
  }
  return byType;
}

/**
 *
 * @param {Window} window
 * @returns {typeof WebMentions}
 */
export function defWebMentions({ HTMLElement, customElements }) {
  class WebMentions extends HTMLElement {
    static register(tagName = "gryphoon-webmentions") {
      if (customElements.get(tagName)) return;
      this.tagName = tagName;
      customElements.define(tagName, this);
    }

    set data(webmentions) {
      const likesOf = this.querySelector(".like-of");
      const repostsOf = this.querySelector(".repost-of");
      const template = this.querySelector("template");

      const byType = groupByType(webmentions);

      function itemTemplate(content, item, section) {
        transform(content, {
          a: {
            href: item.url,
            title: item.author.name,
            classList: x => x.add(section.id),
          },
          time: { dateTime: item.published ?? item["wm-received"] },
          img: {
            alt: item.author.name,
            src: item.author.photo,
          },
        });
      }

      injectItems(likesOf, template, byType.get("like-of"), itemTemplate);
      injectItems(repostsOf, template, byType.get("repost-of"), itemTemplate);
    }
  }

  return WebMentions;
}

if (globalThis.window?.customElements) {
  defWebMentions(window).register();
}
