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
  "fxHide",
  "fxFlex",
  "fxFlex.xs",
  "fxFlex.sm",
  "fxFlex.md",
  "fxFlex.lg",
  "fxFlex.xl",
  "fxFlex.lt-sm",
  "fxFlex.lt-md",
  "fxFlex.lt-lg",
  "fxFlex.lt-xl",
  "fxFlex.gt-xs",
  "fxFlex.gt-sm",
  "fxFlex.gt-md",
  "fxFlex.gt-lg",
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
  const noComments = deleteComments(html);
  return extractHtmlTags(noComments).reduce(
    (html, tag) => html.replace(tag, convertTag(tag)),
    noComments
  );
}

function deleteComments(html) {
  const regex = /<!--[\s\S]*?-->/g;
  return html.replace(regex, "");
}

function convertTag(tag) {
  if (!fxAttributes.some((a) => tag.includes(a))) {
    return tag;
  }

  const $ = load(tag, {
    xmlMode: true,
    decodeEntities: false,
    pseudos: {
      startswith: (el, val) => {
        if (!val) return false;
        const attributes = Object.keys(el.attribs);
        return attributes.some((attr) => attr.startsWith(val));
      },
    },
  });

  $(":startswith(fxLayout)").each((_, elem) => {
    const declarations = getDeclarations(elem, "fxLayout");
    declarations.forEach((declaration) => {
      const { isBreakpoint, breakpoint, declaration: actualDeclaration } = checkBreakpointFxLayout(declaration);

      if (actualDeclaration === "fxLayout") {
        const $element = $(elem);
        const fxLayout = $element.attr(declaration);
        convertFxLayoutToTailwind($element, fxLayout, isBreakpoint, breakpoint, declaration);
      }

      if (actualDeclaration === "fxLayoutGap") {
        const $element = $(elem);
        const fxLayout = $element.attr("fxLayout");
        const fxLayoutGap = $element.attr(declaration);
        convertFxLayoutGapToTailwind($element, fxLayout, fxLayoutGap, isBreakpoint, breakpoint, declaration);
      }

      if (actualDeclaration === "fxLayoutAlign") {
        const $element = $(elem);
        const fxLayoutAlign = $element.attr(declaration);
        convertFxLayoutALignToTailwind($element, fxLayoutAlign, isBreakpoint, breakpoint, declaration);
      }

      if (actualDeclaration === "fxLayout" || actualDeclaration === "fxLayoutGap" || actualDeclaration === "fxLayoutAlign") {
        $(elem).addClass(handleClasses("flex")).removeAttr(declaration);
      }
    });
  });

  $(":startswith(fxHide)").each((_, elem) => {
    const declarations = getDeclarations(elem, "fxHide");
    declarations.forEach((declaration) => {
      const { isBreakpoint, breakpoint } = checkBreakpoint(declaration);

      const $element = $(elem);
      const classes = handleClasses("tw-collapse", isBreakpoint, breakpoint, declaration);
      $element.addClass(classes).removeAttr(declaration);
    })
  })

  $(":startswith([fxHide)").each((_, elem) => {
    const $element = $(elem);
    const fxHide = $element.attr("[fxHide]");

    const ngClass = `{ 'tw-collapse': ${fxHide} }`;
    $element.attr("[ngClass]", ngClass).removeAttr('[fxHide]')
  })

  $(":startswith(fxFlex)").each((_, elem) => {
    const declarations = getDeclarations(elem, "fxFlex");
    declarations.forEach((declaration) => {
      const { isBreakpoint, breakpoint } = checkBreakpoint(declaration);

      const $element = $(elem);
      let fxFlex = $element.attr(declaration);

      if (!fxFlex) {
        $element.addClass(handleClasses("flex-1")).removeAttr("fxFlex");
        return;
      }

      if (fxFlex.includes("calc")) {
        if (fxFlex.startsWith('calc')) {
          // fxFlex.lt-lg="calc(50% - 24px)"
          $element.addClass(handleClasses(`w-[${fxFlex}]`, isBreakpoint, breakpoint, declaration)).removeAttr(declaration);
        } else if (fxFlex.startsWith('0 0')) {
          // fxFlex.lt-lg="0 0 calc(50% - 24px)"
          const [grow, shrink] = fxFlex.split(" ");
          const basis = fxFlex.split(" ").slice(2).join(" ");
          $element.addClass(handleClasses([`grow-${grow}`, `shrink-${shrink}`, `basis-[${basis}]`], isBreakpoint, breakpoint, declaration)).removeAttr(declaration);
        }

      }

      if (fxFlex === "auto") {
        $element.addClass(handleClasses("flex-auto", isBreakpoint, breakpoint, declaration)).removeAttr(declaration);
        return;
      }

      if (fxFlex.endsWith("%")) {
        const widthClass = convertWidthFromPercentageToFraction(fxFlex);

        if (!widthClass && fxFlex.split(" ").length > 2) {
          const [grow, shrink, basis] = fxFlex.split(" ");
          const basisFraction = percentageToFraction(parseInt(basis));
          $element.addClass(handleClasses([`grow-${grow}`, `shrink-${shrink}`, `basis-${basisFraction}`], isBreakpoint, breakpoint, declaration)).removeAttr(declaration);
        } else {
          const classes = handleClasses(`basis-${widthClass}`, isBreakpoint, breakpoint, declaration);
          $element.addClass(classes).removeAttr(declaration);
        }
      }

      if (fxFlex.endsWith("px")) {
        const widthClass = convertWidthFromPixels($element, fxFlex);
        $element.addClass(handleClasses(widthClass, isBreakpoint, breakpoint, declaration)).removeAttr(declaration);
      }

      if (fxFlex === 'row') {
        $element.addClass(handleClasses("flex-1")).removeAttr("fxFlex");
        return;
      }

      if (fxFlex.split(" ").length > 2) {
        const [grow, shrink, basis] = fxFlex.split(" ");

        $element.addClass(handleClasses([`grow-${grow}`, `shrink-${shrink}`, `basis-${basis}`], isBreakpoint, breakpoint, declaration)).removeAttr(declaration);

      }
    });
  });

  $("[fxFill]").each((_, elem) => {
    const fillClasses = ["h-full", "w-full", "min-h-full", "min-w-full"];
    $(elem).addClass(handleClasses(fillClasses)).removeAttr("fxFill");
  });

  $("[fxFlexFill]").each((_, elem) => {
    const fillClasses = ["h-full", "w-full", "min-h-full", "min-w-full"];
    $(elem).addClass(handleClasses(fillClasses)).removeAttr("fxFlexFill");
  });

  let newTag = $.html();
  newTag = newTag.replace(/(\W\w+)=""/gm, "$1");

  if (newTag.endsWith("/>") && tag.endsWith("/>")) {
    return newTag;
  } else {
    return newTag.slice(0, -2) + ">";
  }
}

function checkBreakpoint(declaration) {
  const result = {
    isBreakpoint: false,
    breakpoint: declaration,
  };

  if (declaration.includes(".")) {
    result.isBreakpoint = true;
    result.breakpoint = declaration.split(".")[1];
  }

  return result
}

function checkBreakpointFxLayout(declaration) {
  const result = {
    isBreakpoint: false,
    breakpoint: null,
    declaration: declaration.split(".")[0],
  };


  if (declaration.includes(".")) {
    result.isBreakpoint = true;
    result.breakpoint = declaration.split(".")[1];
  }

  return result
}

function handleClasses(classes, isBreakpoint = false, breakpoint, declaration) {
  if (!Array.isArray(classes)) classes = [classes];
  const prefix = args.prefix?.endsWith("-") ? args.prefix : `${args.prefix}-`;

  if (isBreakpoint) {
    classes = classes.flatMap((c) => (c ? `${prefix ?? ''}${c}` : [])).join(" ");
    classes = `${breakpoint}:${classes}`;
  } else {
    classes = classes.flatMap((c) => (c ? `${prefix ?? ''}${c}` : [])).join(" ");
  }
  return classes
}

function convertWidthFromPixels($element, pixels) {
  const width = parseInt(pixels);
  const widthClass = width % 4 === 0 ? `w-${width / 4}` : `w-[${width}px]`;
  return widthClass
}

function convertWidthFromPercentageToFraction(fxFlex) {
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

  return widthClass
}

function getDeclarations(elem, name) {
  const attribs = Object.keys(elem.attribs);
  return attribs.filter((attr) => attr.startsWith(name));
}

function convertFxLayoutToTailwind($element, fxLayout, isBreakpoint, breakpoint, declaration) {
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

  $element.addClass(handleClasses(`${className}`, isBreakpoint, breakpoint, declaration));

  if (other === "wrap") {
    $element.addClass(handleClasses(`flex-wrap`, isBreakpoint, breakpoint, declaration));
  }

  if (other === "inline") {
    $element.removeClass("flex");
    $element.addClass(handleClasses(`inline-flex`, isBreakpoint, breakpoint, declaration));
  }

  $element.removeAttr(declaration);
}

function convertFxLayoutGapToTailwind($element, fxLayout, fxLayoutGap, isBreakpoint, breakpoint, declaration) {
  let [layout] = (fxLayout || "column").split(" ");

  if (fxLayoutGap === undefined) return;

  const spacing = Math.ceil(parseFloat(fxLayoutGap) / 4); // convert from pixels
  // const spacing = Math.ceil(parseFloat(fxLayoutGap) * 4); // TODO convert from rem

  if (layout === "row") {
    $element.addClass(handleClasses(`gap-x-${spacing}`, isBreakpoint, breakpoint, declaration));
  } else {
    $element.addClass(handleClasses(`gap-${spacing}`, isBreakpoint, breakpoint, declaration));
  }

  $element.removeAttr(declaration);
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
      inComment = true;
      i++;
    } else if (
      inComment &&
      ch === "-" &&
      nextCh === "-" &&
      html[i + 2] === ">"
    ) {
      inComment = false;
      i += 2;
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
  console.log(`File ${filePath} converted`);
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

function convertFxLayoutALignToTailwind($element, fxLayoutAlign, isBreakpoint, breakpoint, declaration) {
  const [mainAxis, crossAxis] = fxLayoutAlign.split(" ");

  if (mainAxis !== "start" && crossAxis !== "start") {
    const mainAx = mainAxisMap[mainAxis];
    const crossAx = crossAxisMap[crossAxis];

    $element
      .addClass(handleClasses([mainAx, crossAx], isBreakpoint, breakpoint, declaration))
      .removeAttr(declaration);
  } else if (mainAxis !== "start") {
    $element
      .addClass(handleClasses(mainAxisMap[mainAxis], isBreakpoint, breakpoint, declaration))
      .removeAttr(declaration);
  } else {
    $element
      .addClass(handleClasses(crossAxisMap[crossAxis], isBreakpoint, breakpoint, declaration))
      .removeAttr(declaration);
  }
}

processFiles(args.path ?? process.cwd(), convertFile);
