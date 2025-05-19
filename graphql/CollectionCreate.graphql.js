const logger = require("../utils/logger");
/**
 * GraphQL mutation to create a collection
 */
module.exports = `#graphql
  mutation CreateCollection($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection {
        id
        title
        handle
        ruleSet {
          rules {
            column
            condition
            relation
          }
          appliedDisjunctively
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;
