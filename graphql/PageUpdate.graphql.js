const logger = require("../utils/Logger");
/**
 * GraphQL mutation to update a page in a Shopify store
 */
module.exports = `#graphql
  mutation UpdatePage($id: ID!, $page: PageUpdateInput!) {
    pageUpdate(id: $id, page: $page) {
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
