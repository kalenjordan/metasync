const logger = require("../utils/Logger");
/**
 * GraphQL query to fetch pages from a Shopify store
 */
module.exports = `#graphql
  query GetPages($first: Int!) {
    pages(first: $first) {
      edges {
        node {
          id
          title
          handle
          bodySummary
          body
          templateSuffix
          isPublished
          createdAt
          updatedAt
          publishedAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;
