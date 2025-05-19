const logger = require("../utils/logger");
/**
 * GraphQL mutation to update a collection
 */
module.exports = `#graphql
  mutation UpdateCollection($input: CollectionInput!) {
    collectionUpdate(input: $input) {
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
