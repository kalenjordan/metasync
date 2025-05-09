/**
 * GraphQL query to fetch a collection by its ID
 */
module.exports = `#graphql
  query GetCollectionById($id: ID!) {
    collection(id: $id) {
      handle
    }
  }
`;
