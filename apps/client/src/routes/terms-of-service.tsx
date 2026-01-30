import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/terms-of-service")({
  component: TermsOfService,
});

function TermsOfService() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link
            to="/login"
            className="text-gray-500 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">Team9</h1>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Team9 User Terms of Service
          </h1>
          <p className="text-gray-500 text-sm">
            Effective Date: January 30, 2026
          </p>
        </div>

        <p className="text-gray-700 leading-relaxed mb-10">
          These User Terms of Service (the "User Terms") govern your access and
          use of our online AI-powered productivity platform and tools (the
          "Services"). Please read them carefully. Even though you are signing
          onto an existing workspace, these User Terms apply to you as a user of
          the Services.
        </p>

        <hr className="border-gray-200 mb-10" />

        {/* Section 1 */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            1. First Things First
          </h2>
          <h3 className="text-base font-semibold text-gray-800 mb-2">
            These User Terms are Legally Binding
          </h3>
          <p className="text-gray-700 leading-relaxed">
            These User Terms are a legally binding contract between you and
            Team9 ("we", "our" and "us"). As part of these User Terms, you agree
            to comply with the most recent version of our Acceptable Use Policy.
            If you access or use the Services, you confirm that you have read,
            understand and agree to be bound by the User Terms and the
            Acceptable Use Policy.
          </p>
        </section>

        {/* Section 2 */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            2. Customer's Choices and Instructions
          </h2>
          <h3 className="text-base font-semibold text-gray-800 mb-2">
            You are an Authorized User on a Workspace Controlled by a "Customer"
          </h3>
          <p className="text-gray-700 leading-relaxed mb-4">
            An organization or other third party that we refer to as "Customer"
            has invited you to a workspace (a unique domain on team9.ai). If you
            are joining your employer's workspace, for example, Customer is your
            employer.
          </p>
          <h3 className="text-base font-semibold text-gray-800 mb-2">
            What This Means for You—and for Us
          </h3>
          <p className="text-gray-700 leading-relaxed">
            Customer has separately agreed to our Customer Terms of Service (the
            "Contract") which permitted Customer to create and configure a
            workspace. When you submit content or information to the Services,
            such as messages, files, or AI prompts ("Customer Data"), you
            acknowledge and agree that the Customer Data is owned by Customer.
            The Contract provides Customer with many choices and control over
            that Customer Data, including the ability to manage permissions,
            export data, or deprovision your access.
          </p>
        </section>

        {/* Section 3 */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            3. Special Provisions for AI and Data
          </h2>
          <h3 className="text-base font-semibold text-gray-800 mb-2">
            Third-Party AI Services Disclaimer
          </h3>
          <p className="text-gray-700 leading-relaxed mb-3">
            The Services integrate and provide access to various third-party
            Artificial Intelligence (AI) models and services (e.g., OpenAI,
            Anthropic, Google). You acknowledge and agree that:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-gray-700 leading-relaxed mb-6">
            <li>
              <strong>No Platform Liability:</strong> Team9 does not own or
              control these third-party AI models. We are not responsible for
              any inaccuracies, biases, errors, or offensive content generated
              by third-party AI.
            </li>
            <li>
              <strong>Privacy &amp; Terms:</strong> Your use of these integrated
              AI tools may be subject to the respective third-party provider's
              privacy policies and terms of service.
            </li>
            <li>
              <strong>Assumption of Risk:</strong> Any reliance on AI-generated
              output is at your own risk. AI output does not constitute
              professional advice (legal, medical, financial, etc.).
            </li>
          </ul>

          <h3 className="text-base font-semibold text-gray-800 mb-2">
            No Liability for Data Loss
          </h3>
          <p className="text-gray-700 leading-relaxed mb-3">
            We implement industry-standard security measures, but we do not
            guarantee that data will never be lost.
          </p>
          <ul className="list-disc pl-6 space-y-2 text-gray-700 leading-relaxed">
            <li>
              <strong>Backup Responsibility:</strong> You and the Customer are
              solely responsible for maintaining independent backups of all
              Customer Data.
            </li>
            <li>
              <strong>Limitation:</strong> Team9 shall have no liability for any
              loss, corruption, or deletion of Customer Data, whether caused by
              system failure, unauthorized access, or accidental deletion. We
              are under no obligation to recover or restore lost data.
            </li>
          </ul>
        </section>

        {/* Section 4 */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            4. The Relationship Between You, Customer and Us
          </h2>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-5 space-y-3">
            <p className="text-gray-700 leading-relaxed text-sm font-medium uppercase">
              As between us and Customer, you agree that it is solely Customer's
              responsibility to: (A) inform you of any relevant Customer
              policies; (B) obtain any necessary consents for the lawful use of
              Customer Data; and (C) resolve any disputes relating to Customer
              Data.
            </p>
            <p className="text-gray-700 leading-relaxed text-sm font-medium uppercase">
              Team9 makes no warranties of any kind, express or implied, to you
              relating to the Services, which are provided to you on an "as is"
              and "as available" basis.
            </p>
          </div>
        </section>

        {/* Section 5 */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            5. A Few Ground Rules
          </h2>
          <ul className="list-disc pl-6 space-y-2 text-gray-700 leading-relaxed">
            <li>
              <strong>Age Requirements:</strong> You represent that you are over
              the legal age of majority in your jurisdiction and at least
              sixteen (16) years of age.
            </li>
            <li>
              <strong>Compliance:</strong> You must comply with our Acceptable
              Use Policy.
            </li>
            <li>
              <strong>Termination:</strong> These User Terms remain effective
              until your access is terminated by Customer or us. We may suspend
              or disable your account if we believe there is a risk of harm to
              us, the Services, or any third parties.
            </li>
          </ul>
        </section>

        {/* Section 6 */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            6. Limitation of Liability
          </h2>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-5">
            <p className="text-gray-700 leading-relaxed text-sm font-medium uppercase">
              In no event will you or we have any liability to the other for any
              lost profits or revenues or for any indirect, special, incidental,
              or consequential damages. Our maximum aggregate liability to you
              for any breach of these User Terms is one dollar ($1).
            </p>
          </div>
        </section>

        {/* Section 7 */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            7. General Provisions
          </h2>

          <div className="space-y-5">
            <div>
              <h3 className="text-base font-semibold text-gray-800 mb-1">
                Privacy Policy
              </h3>
              <p className="text-gray-700 leading-relaxed">
                Please review our Privacy Policy at team9.ai/privacy for
                information on how we collect and use data.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-gray-800 mb-1">
                Modifications
              </h3>
              <p className="text-gray-700 leading-relaxed">
                As our business evolves, we may change these User Terms. If we
                make a material change, we will provide you with reasonable
                notice (via email or in-app message). Using the Services after
                the effective date constitutes your acceptance of the revised
                terms.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-gray-800 mb-1">
                Governing Law
              </h3>
              <p className="text-gray-700 leading-relaxed">
                The User Terms will be governed by the laws applicable to the
                Contract between Team9 and the Customer. You consent to the
                exclusive jurisdiction of the courts specified in that Contract.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-gray-800 mb-1">
                Severability
              </h3>
              <p className="text-gray-700 leading-relaxed">
                If any provision of these User Terms is held to be contrary to
                law, that provision will be modified to the minimum extent
                necessary, and the remaining provisions will remain in effect.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-gray-800 mb-1">
                Contacting Team9
              </h3>
              <p className="text-gray-700 leading-relaxed">
                Please feel free to contact us if you have any questions about
                these User Terms at{" "}
                <a
                  href="mailto:legal@team9.ai"
                  className="text-purple-600 hover:underline"
                >
                  legal@team9.ai
                </a>
                .
              </p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <hr className="border-gray-200 mb-6" />
        <footer className="text-center text-sm text-gray-500 pb-12">
          <p>&copy; 2026 Team9. All rights reserved.</p>
        </footer>
      </main>
    </div>
  );
}
