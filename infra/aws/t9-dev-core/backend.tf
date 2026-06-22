terraform {
  backend "s3" {
    bucket         = "team9-tfstate"
    key            = "team9/dev-core/terraform.tfstate"
    region         = "us-east-1"
    profile        = "t9"
    dynamodb_table = "terraform-state-lock"
    encrypt        = true
  }
}
