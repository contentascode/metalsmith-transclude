const debug = require('debug')('metalsmith:transclude');
const hercule = require('hercule');
const async = require('async');
const path = require('path');
const match = require('multimatch');
const stream = require('stream');
const pointer = require('json-pointer');
const omit = require('lodash/omit');

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
  const { patterns = ['**/*.md'], comments = false, frontmatter = false, verbose = true, warning = true } =
    options || {};

  return function transclude(files, metalsmith, done) {
    const processedFiles = {};
    async.eachOfSeries(
      files,
      (file, key, cb) => {
        debug('>> Processing %s', key);

        if (match(key, patterns).length === 0) {
          debug('skip', key);
          return cb(); // do nothing
        }

        // TODO: Submit issue to hercule to allow returning context from resolver to avoid mutable state.
        const current_metadata = {};

        function resolveMetalsmith(url, sourcePath) {
          debug('>>> resolveMetalsmith             :', url);
          sourcePath !== 'string' && debug('>>> SourcePath                    :', sourcePath);

          const isLocalUrl = /^[^ ()"']+/;
          if (!isLocalUrl.test(url)) return null;

          const isSectionUrl = /#+/;
          const section = url.match(isSectionUrl);

          const baseUrl = section ? url.slice(0, section.index) : url;

          // If there is a sourcePath then we're in a nested transclusion

          // const relativePath = path.dirname(sourcePath);
          // const targetKey = path.join(path.dirname(key), url);
          const targetKey =
            sourcePath !== 'string'
              ? path.join(path.dirname(sourcePath), baseUrl)
              : path.join(path.dirname(key), baseUrl);

          debug('>>> Using target key              :', targetKey);
          const resolvedKey = (files[targetKey] && targetKey) || (files[targetKey + '.md'] && targetKey + '.md');
          if (!resolvedKey) {
            if (warning) console.log(`Missing transclusion destination in ${key}: ${targetKey}`);
            return null;
          }
          debug('>>> Found target file             :', resolvedKey);

          // TODO: This should merge the frontmatter with the pipeline file metadata with
          // a priority to the file metadata to avoid suprises
          // if this plugin is after file metadata modification steps
          //
          // debug('section', section);

          const transcluded = section
            ? extractSection(
                files[resolvedKey].contents.toString(),
                section.input.slice(section.index + section[0].length),
                section[0]
              )
            : files[resolvedKey].contents.toString();
          const metadata = omit(files[resolvedKey], ['contents', 'mode', 'stats']);

          debug('Processes frontmatter. metadata', metadata);
          debug('Processes frontmatter. transcluded', '\n' + transcluded);

          // Local mutation, merge with current transcluded file metadata object.
          // current_metadata = { [url]: metadata };
          frontmatter && pointer.set(current_metadata, '/' + baseUrl.replace('.md', ''), metadata);

          const content = new stream.Readable({ encoding: 'utf8' });
          if (comments)
            content.push(
              `<!-- Following snippet transcluded from ${resolvedKey} ${
                verbose ? 'with resolveMetalsmith.url(' + baseUrl + ')' : ''
              } ${verbose ? JSON.stringify(metadata) : ''} -->\n`
            );
          content.push(transcluded);
          if (comments) content.push(`\n<!-- End of transcluded snippet from ${resolvedKey} -->\n\n`);
          content.push(null);

          return {
            content,
            url: resolvedKey
          };
        }

        const resolvers = [
          resolveMetalsmith,
          // resolveMetalsmithPattern,
          (url, source, placeholder) => ({ content: placeholder })
        ];
        // console.time('hercule')
        hercule.transcludeString(file.contents, { resolvers }, (err, result) => {
          // console.timeEnd('hercule')
          // if (err && err.code === 'ENOENT') {
          //   debug("Couldn't find the following file and skipped it. " + err.path);
          //   return cb();
          // }
          if (err) {
            console.error(err);
            return cb(err);
          }
          // mutate global files array.
          debug('<< Finished processing file: ', key);
          processedFiles[key] = {};
          if (frontmatter) processedFiles[key].metadata = current_metadata;
          if (result) processedFiles[key].contents = result;
          return cb();
        });
      },
      err => {
        if (err) return done(err);
        Object.keys(processedFiles).forEach(key => {
          // Add frontmatter as metadata as well.
          files[key] = Object.assign(files[key], processedFiles[key].metadata, {
            contents: processedFiles[key].contents
          });
        });

        debug('Transcluded!');
        done();
      }
    );
    const extractSection = (source, section, mode) => {
      // debug('source', source);
      // debug('section', section);
      // debug('mode', mode);
      const regexp = new RegExp('^#+ +' + section.replace(/-/g, '[\\W_]'), 'im');
      // First find the matching starting line for the section header
      const match = source.match(regexp);
      const start = match.index;
      // Depending on the mode, find the ending line
      if (mode === '#') {
        // In this mode include only until the next header.
        const endMatch = source.slice(start + match[0].length).match(/^#+ +(.*)$/m);
        return endMatch ? source.slice(start, start + endMatch.index + endMatch[0].length) : source.slice(start);
      } else if (mode === '##') {
        // In this mode include until before the next header at the same level (or until the end of the file)
        const sameLevel = new RegExp('^' + match[0].match(/^#+/)[0] + ' +(.*)$', 'm');
        const endMatch = source.slice(start + match[0].length).match(sameLevel);
        return endMatch ? source.slice(start, start + endMatch.index + endMatch[0].length) : source.slice(start);
      }
    };
  };
}
