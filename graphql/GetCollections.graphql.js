const logger = require("../utils/logger");
/**
 * GraphQL query to fetch all collections with pagination support
 */
module.exports = `#graphql
  query GetCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
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
        }
      }
    }
  }
`;
