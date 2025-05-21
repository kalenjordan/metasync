const logger = require("../utils/Logger");
/**
 * GraphQL mutation to create a page in a Shopify store
 */
module.exports = `#graphql
  mutation CreatePage($page: PageCreateInput!) {
    pageCreate(page: $page) {
      page {
        id
        title
        handle
        templateSuffix
        isPublished
      }
      userErrors {
        field
        message
      }
    }
  }
`;
