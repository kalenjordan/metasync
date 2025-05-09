/**
 * GraphQL query to fetch a collection by its handle
 */
module.exports = `#graphql
  query GetCollectionByHandle($handle: String!) {
    collectionByHandle(handle: $handle) {
      id
      title
      handle
    }
  }
`;
