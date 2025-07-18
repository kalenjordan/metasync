const logger = require("../utils/Logger");
/**
 * GraphQL query to fetch all menus from a Shopify store
 */
module.exports = `#graphql
  query GetMenus($first: Int!, $after: String) {
    menus(first: $first, after: $after) {
      edges {
        node {
          id
          title
          handle
          isDefault
          items {
            id
            title
            type
            url
            resourceId
            tags
            items {
              id
              title
              type
              url
              resourceId
              tags
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;
