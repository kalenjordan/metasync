/**
 * GraphQL query for fetching a single metaobject by ID
 */

const FETCH_METAOBJECT_BY_ID = `#graphql
query GetMetaobjectById($id: ID!) {
  metaobject(id: $id) {
    id
    handle
    type
    displayName
    fields {
      key
      value
      type
      reference {
        ... on MediaImage {
          image {
            url
          }
        }
        ... on Metaobject {
          id
          handle
          type
        }
      }
    }
    capabilities {
      publishable {
        status
      }
    }
  }
}
`;

module.exports = FETCH_METAOBJECT_BY_ID;
