import { defComments } from "./comments.js";
import { defWebMentions } from "./webmentions.js";

/**
 *
 * @param {Window} window
 * @param {Object} dependencies
 * @param {typeof Comments} dependencies.Comments
 * @param {typeof WebMentions} dependencies.WebMentions
 * @returns {typeof Weblog}
 */
export function defWeblog({ HTMLElement, customElements, location }, { Comments, WebMentions }) {
  class Weblog extends HTMLElement {
    static register(tagName = "gryphoon-weblog") {
      if (customElements.get(tagName)) return;
      this.tagName = tagName;
      WebMentions.register();
      Comments.register();
      customElements.define(tagName, this);
    }

    get apiEndpoint() {
      return this.getAttribute("api-endpoint") ?? "/api/v1/weblog";
    }

    get url() {
      return this.getAttribute("href") ?? location.href;
    }

    get loaded() {
      return this.hasAttribute("loaded");
    }

    set loaded(isLoaded) {
      this.toggleAttribute("loaded", Boolean(isLoaded));
    }

    async connectedCallback() {
      const commentsComp = this.querySelector(Comments.tagName);
      const webMentionsComp = this.querySelector(WebMentions.tagName);

      if (this.loaded) return;

      const params = new URLSearchParams({ url: this.url });
      const resp = await fetch(`${this.apiEndpoint}?${params}`);
      const { comments, webmentions } = await resp.json();

      if (commentsComp && !comments?.length) commentsComp.remove();
      if (commentsComp) commentsComp.data = comments;

      if (webMentionsComp && !webmentions?.length) webMentionsComp.remove();
      if (webMentionsComp) webMentionsComp.data = webmentions;

      this.loaded = true;
    }
  }

  return Weblog;
}

// auto-register components when in browser env with customElements support
if (globalThis.window?.customElements) {
  const Comments = defComments(window);
  const WebMentions = defWebMentions(window);
  defWeblog(window, { Comments, WebMentions }).register();
}
