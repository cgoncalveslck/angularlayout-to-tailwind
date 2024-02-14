const fs = require("fs");
const path = require("path");
const { load } = require("cheerio");
const args = getArgs();

const mainAxisMap = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  "space-around": "justify-around",
  "space-between": "justify-between",
  "space-evenly": "justify-evenly",
  "flex-start": "justify-start",
  "flex-end": "justify-end",
};

const crossAxisMap = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  baseline: "items-baseline",
  stretch: "items-stretch",
  "flex-start": "items-start",
  "flex-end": "items-end",
};

const fxAttributes = [
  "fxFill",
  "fxLayout",
  "fxLayoutAlign",
  "fxGap",
  "fxFlex",
  "fxFlex.lt-lg",
];

function getArgs() {
  const args = {};

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--")) {
      const [longArgFlag, longArgValue = true] = arg.slice(2).split("=");
      args[longArgFlag] = longArgValue;
    } else if (arg.startsWith("-")) {
      for (const flag of arg.slice(1)) {
        args[flag] = true;
      }
    }
  }

  return args;
}

function convertFlexLayoutToTailwind(filePath) {
  const html = fs.readFileSync(filePath, "utf-8");
  return extractHtmlTags(html).reduce(
    (html, tag) => html.replace(tag, convertTag(tag)),
    html
  );
}

function convertTag(tag) {
  if (!fxAttributes.some((a) => tag.includes(a))) {
    return tag;
  }

  const $ = load(tag, {
    xmlMode: true,
    decodeEntities: false,
    pseudos: {
      // const $ = cheerio.load('<div class="foo"></div><div data-bar="boo"></div>', {
      //   pseudos: {
      //     // `:foo` is an alias for `div.foo`
      //     foo: 'div.foo',
      //     // `:bar(val)` is equivalent to `[data-bar=val s]`
      //     bar: (el, val) => el.attribs['data-bar'] === val,
      //   },
      // });

      // $(':foo').length; // 1
      // $('div:bar(boo)').length; // 1
      // $('div:bar(baz)').length; // 0

      //create a hasAttributeStartingWith pseudo selector to check if the element has any attribute starting with a given string
      startswith: (el, val) => {
        if (!val) return false;
        const attributes = Object.keys(el.attribs);
        return attributes.some((attr) => attr.startsWith(val));
      },
    },
  });

  $("[fxLayout], [fxLayoutGap], [fxLayoutAlign]").each((_, element) => {
    const $element = $(element);

    const fxLayout = $element.attr("fxLayout");
    const fxLayoutGap = $element.attr("fxLayoutGap");
    const fxLayoutAlign = $element.attr("fxLayoutAlign");

    if (fxLayout) {
      convertFxLayoutToTailwind($element, fxLayout);
    }

    if (fxLayoutGap) {
      convertFxLayoutGapToTailwind($element, fxLayout, fxLayoutGap);
    }

    if (fxLayoutAlign) {
      convertFxLayoutALignToTailwind($element, fxLayoutAlign);
    }

    if (fxLayout || fxLayoutGap || fxLayoutAlign) {
      $element.addClass(handleClasses("flex"));
    }
  });

  $(":startswith(fxFlex)").each((_, elem) => {
    const breakpoints = getBreakpoints(elem, "fxFlex");
    // [ 'fxFlex', 'fxFlex.lt-md' ]
    breakpoints.forEach((breakpoint) => {
      const $element = $(elem);
      let fxFlex = $element.attr(breakpoint);

      if (!fxFlex) {
        $element.addClass(handleClasses("flex-1")).removeAttr("fxFlex");
        return;
      }

      if (fxFlex === "auto") {
        $element.addClass(handleClasses("flex-auto")).removeAttr("fxFlex");
        return;
      }

      if (fxFlex.endsWith("%")) {
        convertWidthFromPercentageToFraction($element, fxFlex);
      }

      if (fxFlex.endsWith("px")) {
        convertWidthFromPixels($element, fxFlex);
      }
    });
  });
  // });

  // $("[fxFlex]").each((_, elem) => {
  //   const $element = $(elem);
  //   let fxFlex = $element.attr("fxFlex");

  //   if (!fxFlex) {
  //     $element.addClass(handleClasses("flex-1")).removeAttr("fxFlex");
  //     return;
  //   }

  //   if (fxFlex === "auto") {
  //     $element.addClass(handleClasses("flex-auto")).removeAttr("fxFlex");
  //     return;
  //   }

  //   if (fxFlex.endsWith("%")) {
  //     convertWidthFromPercentageToFraction($element, fxFlex);
  //   }

  //   if (fxFlex.endsWith("px")) {
  //     convertWidthFromPixels($element, fxFlex);
  //   }
  // });

  $("[fxFill]").each((_, elem) => {
    const fillClasses = ["h-full", "w-full", "min-h-full", "min-w-full"];
    $(elem).addClass(handleClasses(fillClasses)).removeAttr("fxFill");
  });

  let newTag = $.html();
  newTag = newTag.replace(/(\W\w+)=""/gm, "$1");

  if (newTag.endsWith("/>") && tag.endsWith("/>")) {
    return newTag;
  } else {
    return newTag.slice(0, -2) + ">";
  }
}

function handleClasses(classes) {
  if (!Array.isArray(classes)) classes = [classes];
  const prefix = args.prefix.endsWith("-") ? args.prefix : `${args.prefix}-`;

  return classes.flatMap((c) => (c ? `${prefix}${c}` : [])).join(" ");
}

function convertWidthFromPixels($element, pixels) {
  const width = parseInt(pixels);
  const widthClass = width % 4 === 0 ? `w-${width / 4}` : `w-[${width}px]`;

  $element.addClass(handleClasses(widthClass)).removeAttr("fxFlex");
}

function convertWidthFromPercentageToFraction($element, fxFlex) {
  let widthClass = "";
  const percentage = fxFlex.slice(0, -1);
  if (isNaN(+percentage)) return;

  switch (+percentage) {
    case 33:
      widthClass = "1/3";
      break;
    case 66:
      widthClass = "2/3";
      break;
    case 100:
      widthClass = "full";
      break;
    default:
      widthClass = percentageToFraction(+percentage);
      break;
  }

  $element.addClass(handleClasses(`basis-${widthClass}`)).removeAttr("fxFlex");
}

function getBreakpoints(elem, name) {
  const attribs = Object.keys(elem.attribs);
  return attribs.filter((attr) => attr.startsWith(name));
}

function convertFxLayoutToTailwind($element, fxLayout) {
  let [layout, other] = (fxLayout || "column").split(" ");

  let className = "";
  switch (layout) {
    case "row":
      className = "flex-row";
      break;
    case "column":
      className = "flex-col";
      break;
    case "row-reverse":
      className = "flex-row-reverse";
      break;
    case "column-reverse":
      className = "flex-col-reverse";
      break;
    default:
      console.log(`Unknown layout: ${layout}`);
      return;
  }

  $element.addClass(handleClasses(`${className}`));

  if (other === "wrap") {
    $element.addClass(handleClasses(`flex-wrap`));
  }

  if (other === "inline") {
    $element.removeClass("flex");
    $element.addClass(handleClasses(`inline-flex`));
  }

  $element.removeAttr("fxLayout");
}

function convertFxLayoutGapToTailwind($element, fxLayout, fxLayoutGap) {
  let [layout] = (fxLayout || "column").split(" ");

  if (fxLayoutGap === undefined) return;

  const spacing = Math.ceil(parseFloat(fxLayoutGap) / 4); // convert from pixels
  // const spacing = Math.ceil(parseFloat(fxLayoutGap) * 4); // convert from rem

  if (layout === "row") {
    $element.addClass(handleClasses(`gap-x-${spacing}`));
  } else {
    $element.addClass(handleClasses(`gap-${spacing}`));
  }

  $element.removeAttr("fxLayoutGap");
}

function gcd(a, b) {
  if (!b) {
    return a;
  }
  return gcd(b, a % b);
}

function percentageToFraction(percentage) {
  const denominator = 100;
  const numerator = percentage;
  const gcdValue = gcd(numerator, denominator);
  const simplifiedNumerator = numerator / gcdValue;
  const simplifiedDenominator = denominator / gcdValue;
  return `${simplifiedNumerator}/${simplifiedDenominator}`;
}

function extractHtmlTags(html) {
  let openingTags = [];
  let tag = "";
  let inTag = false;
  let quote = null;
  let inComment = false;

  for (let i = 0; i < html.length; i++) {
    const ch = html[i];
    const nextCh = html[i + 1];

    if (!inComment && !inTag && ch === "<" && nextCh === "!") {
      // Start of HTML comment
      inComment = true;
      i++; // skip the next character as well (the '!' character)
    } else if (
      inComment &&
      ch === "-" &&
      nextCh === "-" &&
      html[i + 2] === ">"
    ) {
      // End of HTML comment
      inComment = false;
      i += 2; // skip the next two characters as well (the '-->' characters)
    } else if (!inComment && !inTag && ch === "<") {
      inTag = true;
      tag += ch;
    } else if (inTag) {
      tag += ch;

      if (quote === null && (ch === '"' || ch === "'")) {
        quote = ch;
      } else if (quote !== null && ch === quote) {
        quote = null;
      } else if (quote === null && ch === ">") {
        openingTags.push(tag);
        tag = "";
        inTag = false;
      }
    }
  }

  return openingTags;
}

function convertFile(filePath) {
  const convertedData = convertFlexLayoutToTailwind(filePath);
  fs.writeFileSync(filePath, convertedData, "utf-8");
  // console.log(`File ${filePath} converted`);
}

function processFiles(folderPath, processFile, processFolder, level = 0) {
  if (fs.existsSync(folderPath)) {
    fs.readdirSync(folderPath).forEach((file) => {
      const currentPath = path.join(folderPath, file);
      if (fs.lstatSync(currentPath).isDirectory()) {
        if (
          currentPath.endsWith("node_modules") ||
          currentPath.endsWith("dist")
        ) {
          return;
        }

        if (processFiles(currentPath, processFile, processFolder, level + 1)) {
          processFolder?.(currentPath);
        }
      } else {
        if (currentPath.endsWith(".html")) {
          processFile(currentPath, level);
        }
      }
    });
    return true;
  } else {
    return false;
  }
}

function convertFxLayoutALignToTailwind($element, fxLayoutAlign) {
  const [mainAxis, crossAxis] = fxLayoutAlign.split(" ");

  if (mainAxis !== "start" && crossAxis !== "start") {
    const mainAx = mainAxisMap[mainAxis];
    const crossAx = crossAxisMap[crossAxis];

    $element
      .addClass(handleClasses([mainAx, crossAx]))
      .removeAttr("fxLayoutAlign");
  } else if (mainAxis !== "start") {
    $element
      .addClass(handleClasses(mainAxisMap[mainAxis]))
      .removeAttr("fxLayoutAlign");
  } else {
    $element
      .addClass(handleClasses(crossAxisMap[crossAxis]))
      .removeAttr("fxLayoutAlign");
  }
}

processFiles("/home/claudiogoncalveslck/Work/frontend", convertFile);
