const express = require("express")
const bodyParser = require("body-parser")

const app = express()

app.use(bodyParser.json())

const compiler = require("compilex")

const options = {stats: true}
compiler.init(options)

app.use('/codemirror-5.65.12', express.static("./codemirror-5.65.12"))

app.post('/', (req, res) => {
  const data = req.body;
  console.log(`Problem name: ${data.name}`);
  console.log(`Problem group: ${data.group}`);
  console.log('Full body:');
  console.log(JSON.stringify(data, null, 4));

  console.log('Visit: http://localhost:10043/app');

  res.sendStatus(200);
});

app.get("/app", function(req, res){
  res.sendFile("./v2.html", { root: '.' });
})

app.post("/compile", function(req, res){
  var code = req.body.code
  var input = req.body.input
  var lang = req.body.lang
  var osys = req.body.os

  // free temp dir 
  compiler.flush(function(){
    console.log("Files Deleted")
  });

  try {
    function handleCompilerOutput(data) {
        if (data.output) {
          res.send(data);
        } else {
          res.send({ output: "error" });
        }
    }
      
    switch (lang) {
      case "c":
      case "c++":
        var command = (osys == "windows") ? "g++" : "gcc";
        if (input) {
            compiler.compileCPPWithInput({ OS: osys, cmd: command, options: { timeout: 10000 } }, code, input, handleCompilerOutput);
        } else {
            compiler.compileCPP({ OS: osys, cmd: command, options: { timeout: 10000 } }, code, handleCompilerOutput);
        }
        break;
      case "java":
        if (input) {
          compiler.compileJavaWithInput({ OS: osys }, code, input, handleCompilerOutput);
        } else {
          compiler.compileJava({ OS: osys }, code, handleCompilerOutput);
        }
        break;  
      case "python":
        if (input) {
          compiler.compilePythonWithInput({ OS: osys }, code, input, handleCompilerOutput);
        } else {
          compiler.compilePython({ OS: osys }, code, handleCompilerOutput);
        }
        break;
      default:
        res.send({ output: "Invalid language" });
    }
  } 
  catch (e) {
    console.log("error", e);
  }
});

app.listen(10043, err => {
  console.log(`Listening on port 10043`);
});