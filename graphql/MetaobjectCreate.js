/**
 * GraphQL mutation for creating a metaobject
 */

const CREATE_METAOBJECT = `#graphql
mutation createMetaobject($metaobject: MetaobjectCreateInput!) {
  metaobjectCreate(metaobject: $metaobject) {
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

module.exports = CREATE_METAOBJECT;
