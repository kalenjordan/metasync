const logger = require("../utils/Logger");
/**
 * GraphQL mutation to update a menu
 */
module.exports = `#graphql
  mutation UpdateMenu($id: ID!, $input: MenuUpdateInput!) {
    menuUpdate(id: $id, input: $input) {
      menu {
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
      userErrors {
        field
        message
        code
      }
    }
  }
`;
