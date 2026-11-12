(ns work.gryphoon.texy.passes
  "Transform passes (port of Texy\\Passes\\* - the ported subset): heading
  level balancing (dynamic or fixed, like HeadingPass)."
  (:require
   [clojure.string :as str]
   [work.gryphoon.texy.normalize :as norm]
   [work.gryphoon.texy.engine :as engine])
  (:import
    (java.text Normalizer Normalizer$Form)))

(defn transform-nodes
  "Applies f to every node bottom-up (children first), rebuilding the
  child collections :content, :items, :caption and :image (as vectors;
  the figure's :image holds a single node). f receives a node map and
  returns a node map or nil to remove the node (a removed figure :image
  disappears from the map)."
  [f node]
  (let [node (reduce (fn [node key]
                       (cond
                         (sequential? (get node key))
                         (update node key #(filterv some? (map (partial transform-nodes f) %)))
                         (and (map? (get node key)) (contains? (get node key) :type))
                         (let [child (transform-nodes f (get node key))]
                           (if (nil? child) (dissoc node key) (assoc node key child)))
                         :else node))
                     node
                     [:content :items :caption :image :rows :cells])]
    (f node)))

(defn transform-nodes-except-code
  "Like transform-nodes, but never descends into a :code-block node: the
  pre-parsed content of /--texysource (and other code blocks) keeps its
  written form, like the reference passes that skip CodeBlockNode."
  [f node]
  (if (= :code-block (:type node))
    node
    (f (reduce (fn [node key]
                 (cond
                   (sequential? (get node key))
                   (update node key #(filterv some? (map (partial transform-nodes-except-code f) %)))
                   (and (map? (get node key)) (contains? (get node key) :type))
                   (let [child (transform-nodes-except-code f (get node key))]
                     (if (nil? child) (dissoc node key) (assoc node key child)))
                   :else node))
               node
               [:content :items :caption :image :rows :cells]))))

(defn transform-content
  "Applies f to every child collection (:content, :items, :caption) of
  every node, bottom-up: f receives the collection and returns the new
  one. Used by the HTML pairing and sanitize passes, which operate per
  content container."
  [f doc]
  (transform-nodes
   (fn [node]
     (reduce (fn [node key]
               (if (sequential? (get node key))
                 (update node key f)
                 node))
             node
             [:content :items :caption :rows :cells]))
   doc))

(defn- collect-headings
  "All headings outside code blocks (the reference HeadingNode::collectFrom
  does not traverse into CodeBlockNode, so /--texysource samples keep
  their written levels)."
  [doc]
  (letfn [(walk [node]
            (if (= :code-block (:type node))
              []
              (let [children (concat (get node :content []) (get node :items [])
                                     (get node :caption []) (get node :rows [])
                                     (mapcat :cells (get node :rows []))
                                     (when (map? (get node :image)) [(get node :image)]))]
                (concat (when (= :heading (:type node)) [node])
                        (mapcat walk children)))))]
    (into [] (walk doc))))

(def ^:private non-decomposables
  "The letters Unicode normalization cannot handle: strokes, slashes
  and ligatures have no decomposition, so their ASCII equivalents
  (matching the reference's iconv transliteration and Nette's table)
  stay as an explicit residual. Every other accented letter comes from
  the NFD + combining-mark removal in to-ascii."
  {\đ "d" \Đ "D"                     ; D with stroke
   \ð "d" \Ð "D"                     ; eth
   \ł "l" \Ł "L"                     ; L with stroke
   \ø "o" \Ø "O"                     ; O with stroke
   \þ "th" \Þ "Th"                   ; thorn
   \æ "ae" \Æ "Ae" \œ "oe" \Œ "Oe"   ; ligatures
   \ß "ss"})                         ; sharp s (no uppercase form)

(defn- to-ascii
  "Converts UTF-8 to ASCII: Unicode normalization (NFD) removes the
  accents (every combining mark of every script is stripped), the
  residual table maps the letters normalization cannot decompose."
  ^String [^String s]
  (-> (str/join (map #(or (get non-decomposables %) %) s))
      (Normalizer/normalize Normalizer$Form/NFD)
      (str/replace #"\p{M}" "")))

(defn- webalize
  "Converts to web-safe [a-z0-9-] text (the reference Helpers::webalize);
  format characters (soft hyphen, zero-width joiners) do not survive
  into the slug - they would not split the word."
  ^String [^String s]
  (-> (norm/lower-case (to-ascii (str/replace s #"\p{Cf}" "")))
      (str/replace #"[^a-z0-9]+" "-")
      (str/replace #"^-+|-+$" "")))

(defn- unique-id [id used]
  (if-not (contains? @used id)
    id
    (loop [n 2]
      (let [id' (str id "-" n)]
        (if-not (contains? @used id') id' (recur (inc n)))))))

(defn- hoist-toc
  "Moves the {toc: ...} style out of the heading modifier: it is transport
  syntax and must never reach the output (the reference hoistOverride)."
  [node]
  (let [title (get-in node [:modifier :styles "toc"])]
    (if (nil? title)
      node
      (-> node
          (update-in [:modifier :styles] dissoc "toc")
          (assoc :title-override title)))))

(defn- heading-title
  "The heading as plain text: the override, or the content's text
  (the reference HeadingNode::getTitle)."
  [node]
  (or (:title-override node)
      (str/trim (engine/extract-text node))))

(def heading-levels
  "Underline character => written level 1..6 (the reference
  TexyConfig::headingLevels)."
  {\# 1 \* 2 \= 3 \- 4})

(defn heading-written-level
  "The level as written, by the notation alone (the reference
  HeadingModule::readLevel): an underlined heading's underline character
  maps through heading-levels, a surrounded heading's marker length
  counts (clamped to 2..7; more characters mean a higher heading unless
  more-means-higher is off)."
  ([subtype marker] (heading-written-level subtype marker true))
  ([subtype ^String marker more-means-higher]
   (case subtype
     :underlined (get heading-levels (first marker))
     :surrounded (let [length (max 2 (min 7 (count marker)))]
                  (if more-means-higher (- 8 length) (dec length)))
     nil)))

(defn balance-headings
  "Balances heading levels on the document (returns a new document), and
  applies the rest of the reference's heading machinery: hoists the
  {toc: ...} style off the modifier (it must never reach the output),
  shifts every level by :top (the reference HeadingPass) and, when
  :generate-ids is on, gives every heading a slug id (webalized title,
  :id-prefix prefix, uniquified; an explicit modifier id wins and
  reserves its name before any generated id).

  Dynamic level balancing (default, the reference
  HeadingModule::balanceLevels): both families are read by the notation
  alone - the underlined styles rank by the order of their written
  levels in the document, the surrounded ones shift relative to the
  highest of their written levels - so both end at :top.

  Fixed: the written levels only shift by :top and are clamped to 1..6."
  ([doc] (balance-headings doc {}))
  ([doc {:keys [top dynamic generate-ids id-prefix more-means-higher]
         :or {top 1, dynamic true, generate-ids false, id-prefix "toc-", more-means-higher true}}]
   (let [headings (collect-headings doc)
         written (fn [node]
                   (when-some [marker (:marker node)]
                     (heading-written-level (:subtype node) marker more-means-higher)))
         ;; underlined styles rank by written level; surrounded ones
         ;; shift against the highest written level they use
         order (into {}
                     (map-indexed (fn [rank level] [level rank]))
                     (sort (distinct (keep (fn [node] (when (= (:subtype node) :underlined) (written node))) headings))))
         stop (let [levels (keep (fn [node] (when (= (:subtype node) :surrounded) (written node))) headings)]
                (if (seq levels) (reduce min levels) Long/MAX_VALUE))
         level-of (fn [node]
                    (let [w (written node)]
                      (-> (cond
                            ;; a heading built without a marker keeps its level
                            (nil? w) (:level node)
                            (not dynamic) w
                            (= :underlined (:subtype node)) (inc (get order w 0))
                            :else (inc (- w stop)))
                          (+ top)
                          (dec)
                          (max 1)
                          (min 6))))
         used-id (atom #{})
         generate-id (fn [node]
                       (let [explicit (get-in node [:modifier :id])]
                         (if explicit
                           (assoc node :id explicit)
                           (let [id (unique-id (str id-prefix (webalize (heading-title node))) used-id)]
                             (swap! used-id conj id)
                             (assoc node :id id)))))]
     ;; explicit ids reserve their names first, so a generated one never
     ;; collides with an explicit one later in the document
     (doseq [node headings
             :let [explicit (get-in node [:modifier :id])]
             :when explicit]
       (swap! used-id conj explicit))
     (transform-nodes-except-code
      (fn [node]
        (if (not= :heading (:type node))
          node
          (let [node (hoist-toc (assoc node :level (level-of node)))]
            (if generate-ids
              (generate-id node)
              node))))
      doc))))
