let Ast = require("ast.js");
let Log = require("log.js");
let Debug = require("debug.js");

function resolve_identifiers(code) {
  let identifiers = [];
  function Scope(parent) {
    this.parent = parent || null;
  }
  Scope.prototype = {
    /**
     * @param {string} key
     */
    get: function(key) {
      Debug.log("Looking for variable: "+key);
      if (typeof key != "string") throw new TypeError();
      let inner_key = ":" + key;
      return this._get(":" + key);
    },
    /**
     * @param {Ast.VariableDeclarator} declaration
     */
    put: function(declaration) {
      Debug.log("Putting variable: "+declaration.id.name);
      if (!(declaration instanceof Ast.VariableDeclarator)) throw new TypeError();
      let inner_key = ":" + declaration.id.name;
      let uid = identifiers.push(declaration);
      this[inner_key] = declaration;
      return uid;
    },
    local_get: function(key) {
      return this[":" + key];
    },
    _get: function(inner_key) {
      let link = this;
      do {
        let result = link[inner_key];
        if (result) {
          return result;
        }
        link = link.parent;
      } while(link);
      return null;
    },
    enter: function() {
      return new Scope(this);
    }
  };
  let global_scope   = new Scope();
  ["Object", "Array", "String", "Date",
   "undefined",
   "require", "exports"
  ].forEach(
    function(global) {
      let id = new Ast.Identifier(Ast.SourceLocation.meta, null, null, global);
      global_scope.put(
        new Ast.VariableDeclarator(Ast.SourceLocation.meta, null, null,
                                  id, null, "const")
      );
    }
  );
  let function_scope = global_scope;
  let block_scope    = global_scope;
  let report_redef = function(newdef, olddef, subblock) {
    let kind;
    let logger;
    if (newdef.isConst() || olddef.isConst()) {
      kind = "Constant";
      logger = Log.error;
    } else {
      kind = "Variable";
      logger = Log.warning;
    }
    logger(""+kind+" '"+newdef.id.name+"' was defined twice in the same scope");
    logger("First definition "+olddef.kind+"-style", olddef.loc);
    logger("Second definition"+(subblock?", in a subblock,":"")+
                " "+newdef.kind+"-style",
                newdef.loc);
  };
  let walker =
    {
      VariableDeclaration: {
        exit: function(node) {
          Debug.log("VariableDeclaration.exit");
          for (let i = 0; i < node.declarations.length; ++i) {
            let variable = node.declarations[i];
            // We may have several declarations with the same name
            // in the same scope. In this case, merge them if they
            // are |var|/|let|, reject if one is |const|.
            let previous;
            if ((previous = block_scope.local_get(variable.id.name))
              || (previous = function_scope.local_get(variable.id.name))) {
              // Another let-definition exists in the exact same
              // (block) scope
              report_redef(variable, previous, false);
              // Merge
              variable.id.become(previous.id);
            } else {
              // Nothing weird here, just update the scope
              if (variable.isLet()) {
                variable.id.info.uid = block_scope.put(variable);
              } else {
                variable.id.info.uid = function_scope.put(variable);
              }
              variable.id.info.block = block_scope;
            }
          }
        }
      },
      Identifier: {
        exit: function(node) {
          if (node.binder) {
            Debug.log("Ignoring definition of "+node.name+ " at "+node.loc);
            return; // This is an identifier definition, handled above
          }
          Debug.log("Checking usage of "+node.name);
          let def;
          if (!(def = block_scope.get(node.name))) {
            def = function_scope.get(node.name);
          }
          if (def) {
            node.become(def.id);
          } else {
            Log.warning("Undefined identifier "+node.name, node.loc);
//            def = node;
//            unfound.put(def);
          }

        }
      },
      BlockStatement: {
        enter: function() {
          block_scope = block_scope.enter();
        },
        exit:  function() {
          block_scope = block_scope.parent;
        }
      },
      CatchClause: {
        enter: function(node) {
          // In |catch(x)|, introduce |x| in the local scope
          block_scope = block_scope.enter();
          let definition =
            new Ast.VariableDeclarator(node.param.loc, node.param.range, null,
                                       node.param, null, "catch");
          block_scope.put(definition);
        },
        exit: function() {
          block_scope = block_scope.parent;
        }
      },
      FunctionDeclaration: {
        enter: function(node) {
          // Introduce the function itself in the parent scope
          if (node.id) {
            Debug.log("FunctionDeclaration.enter "+node.id.name);
            let previous;
            let definition = new Ast.VariableDeclarator(node.id.loc, node.id.range, null,
                                                        node.id, null, "function");
            if (  (previous = function_scope.get(node.id.name))
              || (previous = block_scope.get(node.id.name))) {
              report_redef(definition, previous);
            }
            function_scope.put(definition);
          }

          // Then advance to subscope and introduce arguments in that subscope
          block_scope = block_scope.enter();
          function_scope = function_scope.enter();
          for (let i = 0; i < node.params.length; ++i) {
            let current = node.params[i];
            Debug.log("Declaring argument "+current.toSource());
            function_scope.put(new Ast.VariableDeclarator(current.loc, current.range, null,
                                                  current, null, "argument"));
          }

          // Also introduce |arguments|
          function_scope.put(new Ast.VariableDeclarator(node.loc, node.range, null,
                                                        new Ast.Identifier(node.loc, node.range, null,
                                                                          "arguments"), null, "auto"));
        },
        exit: function() {
          Debug.log("FunctionDeclaration.exit");
          block_scope = block_scope.parent;
          function_scope = function_scope.parent;
        }
      },
      get FunctionExpression() {
        delete this.FunctionExpression;
        return this.FunctionExpression = this.FunctionDeclaration;
      }
    };
  return code.walk(walker) || code;
}

exports.resolve = resolve_identifiers;