# Spring Bean Navigator

Spring Bean Navigator is a VS Code extension that brings IntelliJ IDEA-like navigation for Spring Beans and Injections to your Java development workflow. It provides visual cues and quick actions to help you traverse your Spring application context effortlessly.

## Features

- **Gutter Icons**: Instantly identify Spring Beans and injection points with dedicated gutter icons.
- **Show Usages**: Quickly find where a Spring Bean is being injected.
- **Go to Definition**: Jump directly from an injection point to the Bean's implementation.
- **Lombok Support**: Seamlessly works with `@RequiredArgsConstructor` and `final` field injections.

## Supported Annotations

### Spring Beans
The extension identifies the following annotations as Bean definitions:
- `@Component`
- `@Service`
- `@Repository`
- `@Controller`
- `@RestController`
- `@Configuration`
- `@Bean`

### Injections
The extension identifies the following as injection points:
- `@Autowired`
- `@Inject`
- `@Resource`
- `final` fields within classes annotated with `@RequiredArgsConstructor` (Lombok)

## Usage

1. Open any Java file within a Spring project.
2. Look for the Spring icons in the gutter (to the left of the line numbers).
3. Hover over a highlighted annotation to see available actions:
   - For **Beans**: Click **[Show Usages]** to trigger a reference search.
   - For **Injections**: Click **[Go to Bean]** to jump to the Bean's definition.

## Requirements

- This extension activates when a Java file is opened.
- **Language Support for Java™ by Red Hat** is highly recommended for full navigation capabilities (Go to Definition, Find References).
- **Spring Boot Tools** (by VMware/Red Hat) is recommended for a complete Spring development environment.
- Requires a standard Spring Framework project structure for optimal performance.

## Extension Settings

This extension currently does not contribute any specific settings.

## Known Issues

- Navigation might be limited if the project classpath is not correctly configured in VS Code (e.g., via Language Support for Java™ by Red Hat).

## Release Notes

### 0.0.1
- Initial release with basic Gutter icons and Hover actions.
- Support for major Spring stereotypes and Lombok injections.

---

**Enjoy a more productive Spring development experience!**
