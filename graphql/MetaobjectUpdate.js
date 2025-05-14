/**
 * GraphQL mutation for updating a metaobject
 */

const UPDATE_METAOBJECT = `#graphql
mutation updateMetaobject($id: ID!, $metaobject: MetaobjectUpdateInput!) {
  metaobjectUpdate(id: $id, metaobject: $metaobject) {
    metaobject {
      id
      handle
    }
    userErrors {
      field
      message
      code
    }
  }
}
`;

module.exports = UPDATE_METAOBJECT;
