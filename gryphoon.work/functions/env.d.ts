export interface Env {
  ROLLBAR_TOKEN: string;
  SEMANTIC_EXTRACTOR_SECRET: string;
  extractor: Service;
  articlesShare: DurableObjectNamespace<ArticlesShare>;
}
