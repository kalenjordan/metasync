const logger = require("../utils/Logger");
/**
 * GraphQL mutation to create a menu
 */
module.exports = `#graphql
  mutation CreateMenu($input: MenuCreateInput!) {
    menuCreate(input: $input) {
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
