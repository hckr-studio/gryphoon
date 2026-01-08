import { injectItems, transform } from "./lib/dom.js";
import { gravatarUrl } from "./lib/gravatar.js";

/**
 *
 * @param {Window} window
 * @returns {typeof Comments}
 */
export function defComments({ HTMLElement, customElements, document }) {
  class Comments extends HTMLElement {
    static register(tagName = "gryphoon-comments") {
      if (customElements.get(tagName)) return;
      this.tagName = tagName;
      customElements.define(tagName, this);
    }

    get lang() {
      return this.getAttribute("lang") ?? document.documentElement.lang ?? "cs";
    }

    /**
     * @param {Array} comments
     */
    set data(comments) {
      if (!comments?.length) return;

      const template = this.querySelector("template");
      const section = this.querySelector(".comments");
      const locale = this.lang;

      function itemTemplate(content, item, section) {
        const date = new Date(item.created);

        const entry = content.querySelector(".h-entry");
        entry.id += date.valueOf();

        const name = entry.querySelector(".p-name");
        if (item.author.web) {
          const link = document.createElement("a");
          link.href = item.author.web;
          link.rel = "nofollow";
          link.textContent = item.author.name;
          name.insertAdjacentElement("beforeend", link);
        } else {
          name.textContent = item.author.name;
        }

        transform(entry, {
          ".u-url[rel=bookmark]": { href: `#${entry.id}` },
          ".u-photo": {
            src: gravatarUrl(item),
            alt: item.author.name,
          },
          ".p-author .u-url": { href: item.author.web },
          ".e-content": { innerHTML: item.text },
          ".dt-published": {
            datetime: item.created,
            textContent: `${date.toLocaleDateString(locale)} v ${date.toLocaleTimeString(locale)}`,
          },
        });
      }

      injectItems(section, template, comments, itemTemplate);
    }
  }

  return Comments;
}

if (globalThis.window?.customElements) {
  defComments(window).register();
}
