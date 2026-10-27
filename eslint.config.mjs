import nx from "@nx/eslint-plugin";

export default [
    ...nx.configs["flat/base"],
    ...nx.configs["flat/typescript"],
    ...nx.configs["flat/javascript"],
    {
      "ignores": [
        "**/dist",
        "**/out-tsc",
        "**/vite.config.*.timestamp*",
        "**/vitest.config.*.timestamp*"
      ]
    },
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.js",
            "**/*.jsx"
        ],
        rules: {
            "@nx/enforce-module-boundaries": [
                "error",
                {
                    // Libraries are consumed as source via npm workspaces (bundler: none).
                    enforceBuildableLibDependency: false,
                    allow: [
                        "^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$"
                    ],
                    depConstraints: [
                        {
                            sourceTag: "*",
                            onlyDependOnLibsWithTags: [
                                "*"
                            ]
                        }
                    ]
                }
            ]
        }
    },
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.cts",
            "**/*.mts",
            "**/*.js",
            "**/*.jsx",
            "**/*.cjs",
            "**/*.mjs"
        ],
        // Override or add rules here
        rules: {}
    },
    {
        // Vendor SDKs are an implementation detail of @company/frontend-observability.
        // Application code must go through the internal SDK only.
        files: ["apps/**/*.ts", "apps/**/*.tsx", "apps/**/*.js", "apps/**/*.jsx"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["@grafana/*"],
                            message: "Import from @company/frontend-observability instead of Grafana Faro directly."
                        },
                        {
                            group: ["@opentelemetry/*"],
                            message: "Import from @company/frontend-observability instead of OpenTelemetry directly."
                        }
                    ]
                }
            ]
        }
    }
];
