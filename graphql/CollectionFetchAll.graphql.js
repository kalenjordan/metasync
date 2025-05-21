const logger = require("../utils/Logger");
/**
 * GraphQL query to fetch all collections with pagination support
 */
module.exports = `#graphql
  query GetCollections($first: Int!, $after: String, $query: String) {
    collections(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          handle
          description
          descriptionHtml
          seo {
            title
            description
          }
          image {
            id
            url
            altText
          }
          templateSuffix
          sortOrder
          updatedAt
          ruleSet {
            rules {
              column
              condition
              relation
              conditionObject {
                ... on CollectionRuleMetafieldCondition {
                  metafieldDefinition {
                    id
                    namespace
                    key
                    ownerType
                  }
                }
              }
            }
            appliedDisjunctively
          }
          publications(first: 25) {
            edges {
              node {
                channel {
                  id
                  handle
                  name
                }
                isPublished
                publishDate
              }
            }
          }
          metafields(first: 50) {
            edges {
              node {
                id
                namespace
                key
                type
                value
                definition {
                  id
                  namespace
                  key
                  ownerType
                  type {
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;
