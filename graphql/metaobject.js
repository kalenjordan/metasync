/**
 * GraphQL queries and mutations for Metaobject operations
 */

// Fetching metaobject definitions with a specific type
const FETCH_METAOBJECT_DEFINITIONS = `#graphql
  query FetchMetaobjectDefinitions($type: String) {
    metaobjectDefinitions(first: 100, filter: {type: $type}) {
      nodes {
        id
        type
        name
        description
        fieldDefinitions {
          key
          name
          description
          required
          type {
            name
          }
          validations {
            name
            value
          }
        }
        capabilities {
          publishable {
            enabled
          }
        }
        access {
          admin
          storefront
        }
      }
    }
  }
`;

// Fetching all metaobject definitions
const FETCH_ALL_METAOBJECT_DEFINITIONS = `#graphql
  query FetchAllMetaobjectDefinitions {
    metaobjectDefinitions(first: 100) {
      nodes {
        id
        type
        name
        description
        fieldDefinitions {
          key
          name
          description
          required
          type {
            name
          }
          validations {
            name
            value
          }
        }
        capabilities {
          publishable {
            enabled
          }
        }
        access {
          admin
          storefront
        }
      }
    }
  }
`;

// Fetching metaobjects for a specific type
const FETCH_METAOBJECTS = `#graphql
  query GetMetaobjects($type: String!) {
    metaobjects(type: $type, first: 100) {
      edges {
        node {
          id handle type displayName
          fields { key value type reference { ... on MediaImage { image { url } } ... on Metaobject { handle } } }
          capabilities { publishable { status } }
        }
      }
    }
  }
`;

// Creating a metaobject definition
const CREATE_METAOBJECT_DEFINITION = `#graphql
  mutation createMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition { id type }
      userErrors { field message code }
    }
  }
`;

// Updating a metaobject definition
const UPDATE_METAOBJECT_DEFINITION = `#graphql
  mutation updateMetaobjectDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
    metaobjectDefinitionUpdate(id: $id, definition: $definition) {
      metaobjectDefinition { id type }
      userErrors { field message code }
    }
  }
`;

// Creating a metaobject
const CREATE_METAOBJECT = `#graphql
  mutation createMetaobject($metaobject: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $metaobject) {
      metaobject { id handle }
      userErrors { field message code }
    }
  }
`;

// Updating a metaobject
const UPDATE_METAOBJECT = `#graphql
  mutation updateMetaobject($id: ID!, $metaobject: MetaobjectUpdateInput!) {
    metaobjectUpdate(id: $id, metaobject: $metaobject) {
      metaobject { id handle }
      userErrors { field message code }
    }
  }
`;

module.exports = {
  FETCH_METAOBJECT_DEFINITIONS,
  FETCH_ALL_METAOBJECT_DEFINITIONS,
  FETCH_METAOBJECTS,
  CREATE_METAOBJECT_DEFINITION,
  UPDATE_METAOBJECT_DEFINITION,
  CREATE_METAOBJECT,
  UPDATE_METAOBJECT
};
