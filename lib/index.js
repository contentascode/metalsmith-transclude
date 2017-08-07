'use strict';

var debug = require('debug')('metalsmith:transclude');
var hercule = require('hercule');
var async = require('async');
var path = require('path');
var match = require('multimatch');
var stream = require('stream');
var pointer = require('json-pointer');
var omit = require('lodash/omit');
var __ = require('highland');
/**
 * Expose `plugin`.
 */

module.exports = plugin;

/**
 * Metalsmith plugin to transclude content.
 *
 *
 * @param {Object} options
 * @param {string} options.frontmatter Include frontmatter in parent file.
 *
 * @return {Function}
 */

// It feels like a better separation of concerns (particularly to help troubleshoot)
// to have the frontmatter included as yaml in the parent file's content rather than in
// its metadata key. Maybe this could be an option (but I'm not sure how the recursive hercule
// resolution would deal with nested keys whereas the current approach should be more predictable)

function plugin(options) {
  var _ref = options || {},
      _ref$patterns = _ref.patterns,
      patterns = _ref$patterns === undefined ? ['**/*.md'] : _ref$patterns,
      _ref$comments = _ref.comments,
      comments = _ref$comments === undefined ? false : _ref$comments,
      _ref$frontmatter = _ref.frontmatter,
      frontmatter = _ref$frontmatter === undefined ? false : _ref$frontmatter,
      _ref$verbose = _ref.verbose,
      verbose = _ref$verbose === undefined ? true : _ref$verbose;

  return function transclude(files, metalsmith, done) {
    async.eachOfSeries(files, function (file, key, cb) {
      debug('>> Processing %s', key);

      if (match(key, patterns).length === 0) {
        debug('skip', key);
        return cb(); // do nothing
      }

      // TODO: Submit issue to hercule to allow returning context from resolver to avoid mutable state.
      var current_metadata = {};

      function resolveMetalsmith(url, sourcePath) {
        console.time('hercule.resolve.' + key);
        debug('>>> resolveMetalsmith             :', url);
        sourcePath !== 'string' && debug('>>> SourcePath                    :', sourcePath);
        // sourcePath is not needed as we are resolve files that are in the metalsmith file tree
        var isLocalUrl = /^[^ ()"']+/;
        if (!isLocalUrl.test(url)) return null;

        // const relativePath = path.dirname(sourcePath);
        var targetKey = path.join(path.dirname(key), url);
        debug('>>> Using target key              :', targetKey);
        var resolvedKey = files[targetKey] && targetKey || files[targetKey + '.md'] && targetKey + '.md';
        if (!resolvedKey) return null;
        debug('>>> Found target file             :', resolvedKey);

        // TODO: This should merge the frontmatter with the pipeline file metadata with
        // a priority to the file metadata to avoid suprises
        // if this plugin is after file metadata modification steps

        var transcluded = files[resolvedKey].contents;
        var metadata = omit(files[resolvedKey], ['contents', 'mode', 'stats']);

        debug('Processes frontmatter. metadata', metadata);
        debug('Processes frontmatter. transcluded', transcluded);

        // Local mutation, merge with current transcluded file metadata object.
        // current_metadata = { [url]: metadata };
        frontmatter && pointer.set(current_metadata, '/' + url.replace('.md', ''), metadata);

        var content = new stream.Readable({ encoding: 'utf8' });
        if (comments) content.push(`<!-- Following snippet transcluded from ${resolvedKey} ${verbose ? 'with resolveMetalsmith.url(' + url + ')' : ''} ${verbose ? JSON.stringify(metadata) : ''} -->\n`);
        content.push(transcluded.toString());
        if (comments) content.push(`\n<!-- End of transcluded snippet from ${resolvedKey} -->\n\n`);
        content.push(null);
        console.timeEnd('hercule.resolve.' + key);

        return {
          content,
          url: sourcePath === 'string' ? resolvedKey : path.join(sourcePath, resolvedKey)
        };
      }

      var resolvers = [resolveMetalsmith,
      // resolveMetalsmithPattern,
      function (url, source, placeholder) {
        return { content: placeholder };
      }];
      console.time('hercule.' + key);

      // const transcluder = new hercule.TranscludeStream(file.contents.toString(), { resolvers });
      var transcluder = new hercule.TranscludeStream(key, { resolvers });

      // Initiate the source
      var bufferStream = new stream.PassThrough();

      // Write your buffer
      bufferStream.end(file.contents.toString());

      // Pipe it to something else  (i.e. stdout)
      __(bufferStream).through(transcluder).each(function (result) {
        if (frontmatter) files[key] = Object.assign(files[key], current_metadata);
        if (result) files[key].contents = result;
      }).done(function () {
        console.timeEnd('hercule.' + key);
        return cb();
      });

      // hercule.transcludeString(file.contents, { resolvers }, (err, result) => {
      //   // console.timeEnd('hercule.' + key);
      //   // if (err && err.code === 'ENOENT') {
      //   //   debug("Couldn't find the following file and skipped it. " + err.path);
      //   //   return cb();
      //   // }
      //   if (err) {
      //     console.error(err);
      //     return cb(err);
      //   }
      //   // mutate global files array.
      //   debug('<< Finished processing file: ', key);
      //   if (frontmatter) files[key] = Object.assign(files[key], current_metadata);
      //   if (result) files[key].contents = result;
      //   return cb();
      // });
    }, function (err) {
      if (err) return done(err);
      debug('Transcluded!');
      done();
    });

    // const processedFiles = {};
    //
    // __.pairs(files)
    //   .filter(([key]) => match(key, patterns).length === 0)
    //   .each(([key, file]) => {
    //     const current_metadata = {};
    //     debug('>> Processing %s', key);
    //
    //     function resolveMetalsmith(url, sourcePath) {
    //       debug('>>> resolveMetalsmith             :', url);
    //       sourcePath !== 'string' && debug('>>> SourcePath                    :', sourcePath);
    //       // sourcePath is not needed as we are resolve files that are in the metalsmith file tree
    //       const isLocalUrl = /^[^ ()"']+/;
    //       if (!isLocalUrl.test(url)) return null;
    //
    //       // const relativePath = path.dirname(sourcePath);
    //       const targetKey = path.join(path.dirname(key), url);
    //       debug('>>> Using target key              :', targetKey);
    //       const resolvedKey = (files[targetKey] && targetKey) || (files[targetKey + '.md'] && targetKey + '.md');
    //       if (!resolvedKey) return null;
    //       debug('>>> Found target file             :', resolvedKey);
    //
    //       // TODO: This should merge the frontmatter with the pipeline file metadata with
    //       // a priority to the file metadata to avoid suprises
    //       // if this plugin is after file metadata modification steps
    //
    //       const transcluded = files[resolvedKey].contents;
    //       const metadata = omit(files[resolvedKey], ['contents', 'mode', 'stats']);
    //
    //       debug('Processes frontmatter. metadata', metadata);
    //       debug('Processes frontmatter. transcluded', transcluded);
    //
    //       // Local mutation, merge with current transcluded file metadata object.
    //       // current_metadata = { [url]: metadata };
    //       frontmatter && pointer.set(current_metadata, '/' + url.replace('.md', ''), metadata);
    //
    //       const content = new stream.Readable({ encoding: 'utf8' });
    //       if (comments)
    //         content.push(
    //           `<!-- Following snippet transcluded from ${resolvedKey} ${verbose
    //             ? 'with resolveMetalsmith.url(' + url + ')'
    //             : ''} ${verbose ? JSON.stringify(metadata) : ''} -->\n`
    //         );
    //       content.push(transcluded.toString());
    //       if (comments) content.push(`\n<!-- End of transcluded snippet from ${resolvedKey} -->\n\n`);
    //       content.push(null);
    //
    //       return {
    //         content,
    //         url: sourcePath === 'string' ? resolvedKey : path.join(sourcePath, resolvedKey)
    //       };
    //     }
    //
    //     const resolvers = [
    //       resolveMetalsmith,
    //       // resolveMetalsmithPattern,
    //       (url, source, placeholder) => ({ content: placeholder })
    //     ];
    //
    //     // const transcluder = new hercule.TranscludeStream(file.contents.toString(), { resolvers });
    //     const transcluder = new hercule.TranscludeStream(file.contents.toString(), { resolvers });
    //
    //     // Initiate the source
    //     const bufferStream = new stream.PassThrough();
    //
    //     // Write your buffer
    //     bufferStream.end(file.contents.toString());
    //
    //     // Pipe it to something else  (i.e. stdout)
    //     return bufferStream.pipe(transcluder);
    //   })
    //   .set()
    //   .flatMap((...args) => {
    //     console.log(args);
    //     return done();
    //   }).done(() => {
    //     Object.keys(processedFiles).forEach(key => {
    //       // Add frontmatter as metadata as well.
    //       files[key] = Object.assign(files[key], processedFiles[key].metadata, {
    //         contents: processedFiles[key].contents
    //       });
    //     });
    //
    //     debug('Transcluded!');
    //     done();
    //   });
    // .toArray(files => done(null, files));

    //
    //     console.log();
    //
    //     __(file)
    //       .map(content => {
    //         console.log(content);
    //         return content;
    //       })
    //       .map(file => file.contents.toString())
    //       // .through(transcluder)
    //       .map(content => {
    //         console.log(content);
    //         return content;
    //       })
    //       // .errors(function(err) {
    //       //   console.log('Caught error:', err.message);
    //       //   return cb(err);
    //       // })
    //       .done(result => {
    //         debug('<< Finished processing file: ', key);
    //         processedFiles[key] = {};
    //         if (frontmatter) processedFiles[key].metadata = current_metadata;
    //         if (result) processedFiles[key].contents = result;
    //         return cb();
    //       });
    //   },
    //   err => {
    //     console.log('err', err);
    //     if (err) return done(err);
    //     Object.keys(processedFiles).forEach(key => {
    //       // Add frontmatter as metadata as well.
    //       files[key] = Object.assign(files[key], processedFiles[key].metadata, {
    //         contents: processedFiles[key].contents
    //       });
    //     });
    //
    //     debug('Transcluded!');
    //     done();
    //   }
    // );

    //
    // async.eachOfSeries(
    //   files,
    //   (file, key, cb) => {
    //     debug('>> Processing %s', key);
    //
    //     if (match(key, patterns).length === 0) {
    //       debug('skip', key);
    //       return cb(); // do nothing
    //     }
    //
    //     const current_metadata = {};
    //
    //     function resolveMetalsmith(url, sourcePath) {
    //       debug('>>> resolveMetalsmith             :', url);
    //       sourcePath !== 'string' && debug('>>> SourcePath                    :', sourcePath);
    //       // sourcePath is not needed as we are resolve files that are in the metalsmith file tree
    //       const isLocalUrl = /^[^ ()"']+/;
    //       if (!isLocalUrl.test(url)) return null;
    //
    //       // const relativePath = path.dirname(sourcePath);
    //       const targetKey = path.join(path.dirname(key), url);
    //       debug('>>> Using target key              :', targetKey);
    //       const resolvedKey = (files[targetKey] && targetKey) || (files[targetKey + '.md'] && targetKey + '.md');
    //       if (!resolvedKey) return null;
    //       debug('>>> Found target file             :', resolvedKey);
    //
    //       // TODO: This should merge the frontmatter with the pipeline file metadata with
    //       // a priority to the file metadata to avoid suprises
    //       // if this plugin is after file metadata modification steps
    //
    //       const transcluded = files[resolvedKey].contents;
    //       const metadata = omit(files[resolvedKey], ['contents', 'mode', 'stats']);
    //
    //       debug('Processes frontmatter. metadata', metadata);
    //       debug('Processes frontmatter. transcluded', transcluded);
    //
    //       // Local mutation, merge with current transcluded file metadata object.
    //       // current_metadata = { [url]: metadata };
    //       frontmatter && pointer.set(current_metadata, '/' + url.replace('.md', ''), metadata);
    //
    //       const content = new stream.Readable({ encoding: 'utf8' });
    //       if (comments)
    //         content.push(
    //           `<!-- Following snippet transcluded from ${resolvedKey} ${verbose
    //             ? 'with resolveMetalsmith.url(' + url + ')'
    //             : ''} ${verbose ? JSON.stringify(metadata) : ''} -->\n`
    //         );
    //       content.push(transcluded.toString());
    //       if (comments) content.push(`\n<!-- End of transcluded snippet from ${resolvedKey} -->\n\n`);
    //       content.push(null);
    //
    //       return {
    //         content,
    //         url: sourcePath === 'string' ? resolvedKey : path.join(sourcePath, resolvedKey)
    //       };
    //     }
    //
    //     const resolvers = [
    //       resolveMetalsmith,
    //       // resolveMetalsmithPattern,
    //       (url, source, placeholder) => ({ content: placeholder })
    //     ];
    //
    //     // const transcluder = new hercule.TranscludeStream(file.contents.toString(), { resolvers });
    //     const transcluder = new hercule.TranscludeStream(file.contents.toString(), { resolvers });
    //
    //     console.log();
    //
    //     __(file)
    //       .map(content => {
    //         console.log(content);
    //         return content;
    //       })
    //       .map(file => file.contents.toString())
    //       // .through(transcluder)
    //       .map(content => {
    //         console.log(content);
    //         return content;
    //       })
    //       // .errors(function(err) {
    //       //   console.log('Caught error:', err.message);
    //       //   return cb(err);
    //       // })
    //       .done(result => {
    //         debug('<< Finished processing file: ', key);
    //         processedFiles[key] = {};
    //         if (frontmatter) processedFiles[key].metadata = current_metadata;
    //         if (result) processedFiles[key].contents = result;
    //         return cb();
    //       });
    //   },
    //   err => {
    //     console.log('err', err);
    //     if (err) return done(err);
    //     Object.keys(processedFiles).forEach(key => {
    //       // Add frontmatter as metadata as well.
    //       files[key] = Object.assign(files[key], processedFiles[key].metadata, {
    //         contents: processedFiles[key].contents
    //       });
    //     });
    //
    //     debug('Transcluded!');
    //     done();
    //   }
    // );

    // async.eachOf(
    //   files,
    //   (file, key, cb) => {
    //     debug('>> Processing %s', key);
    //
    //     if (match(key, patterns).length === 0) {
    //       debug('skip', key);
    //       return cb(); // do nothing
    //     }
    //
    //     // TODO: Submit issue to hercule to allow returning context from resolver to avoid mutable state.
    //     const current_metadata = {};
    //
    //     function resolveMetalsmith(url, sourcePath) {
    //       debug('>>> resolveMetalsmith             :', url);
    //       sourcePath !== 'string' && debug('>>> SourcePath                    :', sourcePath);
    //       // sourcePath is not needed as we are resolve files that are in the metalsmith file tree
    //       const isLocalUrl = /^[^ ()"']+/;
    //       if (!isLocalUrl.test(url)) return null;
    //
    //       // const relativePath = path.dirname(sourcePath);
    //       const targetKey = path.join(path.dirname(key), url);
    //       debug('>>> Using target key              :', targetKey);
    //       const resolvedKey = (files[targetKey] && targetKey) || (files[targetKey + '.md'] && targetKey + '.md');
    //       if (!resolvedKey) return null;
    //       debug('>>> Found target file             :', resolvedKey);
    //
    //       // TODO: This should merge the frontmatter with the pipeline file metadata with
    //       // a priority to the file metadata to avoid suprises
    //       // if this plugin is after file metadata modification steps
    //
    //       const transcluded = files[resolvedKey].contents;
    //       const metadata = omit(files[resolvedKey], ['contents', 'mode', 'stats']);
    //
    //       debug('Processes frontmatter. metadata', metadata);
    //       debug('Processes frontmatter. transcluded', transcluded);
    //
    //       // Local mutation, merge with current transcluded file metadata object.
    //       // current_metadata = { [url]: metadata };
    //       frontmatter && pointer.set(current_metadata, '/' + url.replace('.md', ''), metadata);
    //
    //       const content = new stream.Readable({ encoding: 'utf8' });
    //       if (comments)
    //         content.push(
    //           `<!-- Following snippet transcluded from ${resolvedKey} ${verbose
    //             ? 'with resolveMetalsmith.url(' + url + ')'
    //             : ''} ${verbose ? JSON.stringify(metadata) : ''} -->\n`
    //         );
    //       content.push(transcluded.toString());
    //       if (comments) content.push(`\n<!-- End of transcluded snippet from ${resolvedKey} -->\n\n`);
    //       content.push(null);
    //
    //       return {
    //         content,
    //         url: sourcePath === 'string' ? resolvedKey : path.join(sourcePath, resolvedKey)
    //       };
    //     }
    //
    //     const resolvers = [
    //       resolveMetalsmith,
    //       // resolveMetalsmithPattern,
    //       (url, source, placeholder) => ({ content: placeholder })
    //     ];
    //     // console.time('hercule.' + key);
    //     hercule.transcludeString(file.contents, { resolvers }, (err, result) => {
    //       // console.timeEnd('hercule.' + key);
    //       // if (err && err.code === 'ENOENT') {
    //       //   debug("Couldn't find the following file and skipped it. " + err.path);
    //       //   return cb();
    //       // }
    //       if (err) {
    //         console.error(err);
    //         return cb(err);
    //       }
    //       // mutate global files array.
    //       debug('<< Finished processing file: ', key);
    //       processedFiles[key] = {};
    //       if (frontmatter) processedFiles[key].metadata = current_metadata;
    //       if (result) processedFiles[key].contents = result;
    //       return cb();
    //     });
    //   },
    //   err => {
    //     if (err) return done(err);
    //     Object.keys(processedFiles).forEach(key => {
    //       // Add frontmatter as metadata as well.
    //       files[key] = Object.assign(files[key], processedFiles[key].metadata, {
    //         contents: processedFiles[key].contents
    //       });
    //     });
    //
    //     debug('Transcluded!');
    //     done();
    //   }
    // );
  };
}